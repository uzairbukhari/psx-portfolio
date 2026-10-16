package app.sipwise.ui

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import app.sipwise.designsystem.BrandColors
import app.sipwise.designsystem.SipwiseTheme
import app.sipwise.designsystem.Spacing
import app.sipwise.vault.PasswordCheck
import app.sipwise.vault.Strength

/** The ink the first-run screens draw with: always light on Night, in light and dark appearance alike. */
object FirstRunInk {
    val night = Color(0xFF070B18)
    val text = Color(0xFFE8EEFA)
    val muted = Color(0xFF9FB0D6)
    val mint = Color(0xFF22E0A0)
    val coral = Color(0xFFFF6F86)
    val amber = Color(0xFFF5B942)
    val field = Color(0x0FFFFFFF)
    val fieldLine = Color(0x1FFFFFFF)
}

/** Splash, sign in and the vault screens are always dark, so they read as one place. */
@Composable
fun FirstRunScene(content: @Composable () -> Unit) {
    SipwiseTheme(darkTheme = true) {
        DarkSystemBars()
        CompositionLocalProvider(LocalContentColor provides FirstRunInk.text) {
            Box(
                Modifier.fillMaxSize().drawBehind {
                    drawRect(FirstRunInk.night)
                    drawRect(Brush.radialGradient(listOf(Color(0xFF13265A), Color.Transparent), Offset(size.width / 2, size.height * 0.3f), size.width * 1.1f))
                },
            ) { content() }
        }
    }
}

/** Light status and navigation bar icons while a first-run screen is up, then whatever the app had. */
@Composable
private fun DarkSystemBars() {
    val view = LocalView.current
    DisposableEffect(view) {
        val window = (view.context as? Activity)?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        val lightStatus = controller?.isAppearanceLightStatusBars
        val lightNav = controller?.isAppearanceLightNavigationBars
        controller?.isAppearanceLightStatusBars = false
        controller?.isAppearanceLightNavigationBars = false
        onDispose {
            if (lightStatus != null) controller.isAppearanceLightStatusBars = lightStatus
            if (lightNav != null) controller.isAppearanceLightNavigationBars = lightNav
        }
    }
}

/** A blue gradient button, 52 dp tall; shows a spinner while [busy]. */
@Composable
fun BrandButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
) {
    val shape = RoundedCornerShape(18.dp)
    Box(
        modifier
            .fillMaxWidth()
            .height(52.dp)
            .clip(shape)
            .background(if (enabled || busy) BrandColors.button else Brush.linearGradient(listOf(Color(0xFF1B2547), Color(0xFF1B2547))))
            .clickable(enabled = enabled && !busy, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.5.dp)
            Text(text, style = MaterialTheme.typography.titleMedium, color = if (enabled || busy) Color.White else FirstRunInk.muted)
        }
    }
}

/** An outlined secondary button on Night. */
@Composable
fun GhostButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    danger: Boolean = false,
) {
    val tone = if (danger) FirstRunInk.coral else FirstRunInk.text
    Box(
        modifier
            .fillMaxWidth()
            .height(52.dp)
            .clip(RoundedCornerShape(18.dp))
            .border(1.dp, if (danger) FirstRunInk.coral.copy(alpha = 0.5f) else FirstRunInk.fieldLine, RoundedCornerShape(18.dp))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = MaterialTheme.typography.titleMedium, color = if (enabled) tone else FirstRunInk.muted)
    }
}

/** A quiet text link. */
@Composable
fun LinkText(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    color: Color = Color(0xFF7DB0FF),
) {
    Text(
        text,
        modifier.clip(RoundedCornerShape(8.dp)).clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(vertical = 8.dp, horizontal = 4.dp),
        style = MaterialTheme.typography.labelLarge,
        color = if (enabled) color else FirstRunInk.muted,
        textAlign = TextAlign.Center,
    )
}

/** A text field styled for Night, with a show or hide toggle for secrets. */
@Composable
fun FirstRunField(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    secret: Boolean = false,
    enabled: Boolean = true,
    isError: Boolean = false,
    supporting: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
) {
    var visible by rememberSaveable { mutableStateOf(false) }
    val colors =
        OutlinedTextFieldDefaults.colors(
            focusedTextColor = FirstRunInk.text,
            unfocusedTextColor = FirstRunInk.text,
            disabledTextColor = FirstRunInk.muted,
            focusedContainerColor = FirstRunInk.field,
            unfocusedContainerColor = FirstRunInk.field,
            disabledContainerColor = FirstRunInk.field,
            errorContainerColor = FirstRunInk.field,
            focusedBorderColor = BrandColors.sky,
            unfocusedBorderColor = FirstRunInk.fieldLine,
            disabledBorderColor = FirstRunInk.fieldLine,
            errorBorderColor = FirstRunInk.coral,
            focusedLabelColor = BrandColors.sky,
            unfocusedLabelColor = FirstRunInk.muted,
            errorLabelColor = FirstRunInk.coral,
            cursorColor = BrandColors.sky,
            focusedSupportingTextColor = FirstRunInk.muted,
            unfocusedSupportingTextColor = FirstRunInk.muted,
            errorSupportingTextColor = FirstRunInk.coral,
        )
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        enabled = enabled,
        isError = isError,
        shape = RoundedCornerShape(16.dp),
        colors = colors,
        supportingText = supporting?.let { { Text(it) } },
        visualTransformation = if (secret && !visible) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (secret) KeyboardType.Password else keyboardType),
        trailingIcon =
            if (secret) {
                {
                    IconButton(onClick = { visible = !visible }) {
                        Icon(
                            if (visible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                            contentDescription = if (visible) "Hide" else "Show",
                            tint = FirstRunInk.muted,
                        )
                    }
                }
            } else {
                null
            },
        modifier = modifier.fillMaxWidth(),
    )
}

/** Step progress across the top of the vault set-up screens. */
@Composable
fun StepperBar(
    step: Int,
    of: Int,
    modifier: Modifier = Modifier,
) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for (i in 1..of) {
            Box(
                Modifier
                    .weight(1f)
                    .height(4.dp)
                    .clip(CircleShape)
                    .background(if (i <= step) BrandColors.progress else Brush.linearGradient(listOf(Color(0x24FFFFFF), Color(0x24FFFFFF)))),
            )
        }
    }
}

/** Four bars that fill with the password's strength, and a word for it. */
@Composable
fun StrengthMeter(
    check: PasswordCheck,
    modifier: Modifier = Modifier,
) {
    val tone =
        when (check.strength) {
            Strength.NONE -> FirstRunInk.muted
            Strength.WEAK -> FirstRunInk.coral
            Strength.FAIR -> FirstRunInk.amber
            Strength.GOOD, Strength.STRONG -> FirstRunInk.mint
        }
    val word =
        when (check.strength) {
            Strength.NONE -> ""
            Strength.WEAK -> "Weak"
            Strength.FAIR -> "Fair"
            Strength.GOOD -> "Good"
            Strength.STRONG -> "Strong"
        }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            for (i in 1..4) {
                Box(Modifier.weight(1f).height(5.dp).clip(CircleShape).background(if (i <= check.strength.level) tone else Color(0x1FFFFFFF)))
            }
        }
        if (word.isNotEmpty()) Text(word, style = MaterialTheme.typography.labelLarge, color = tone)
    }
}

/** One plain requirement with a tick once met. */
@Composable
fun CheckLine(
    text: String,
    met: Boolean,
    modifier: Modifier = Modifier,
) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Box(
            Modifier.size(16.dp).clip(CircleShape).background(if (met) FirstRunInk.mint.copy(alpha = 0.2f) else Color(0x1FFFFFFF)),
            contentAlignment = Alignment.Center,
        ) {
            if (met) Text("✓", color = FirstRunInk.mint, style = MaterialTheme.typography.labelSmall)
        }
        Text(text, style = MaterialTheme.typography.bodySmall, color = if (met) FirstRunInk.text else FirstRunInk.muted)
    }
}

/** An error or warning on Night: a tinted card instead of loose red text. */
@Composable
fun NoticeCard(
    text: String,
    modifier: Modifier = Modifier,
    tone: Color = FirstRunInk.coral,
) {
    Box(modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(tone.copy(alpha = 0.12f)).padding(Spacing.md + 2.dp)) {
        Text(text, style = MaterialTheme.typography.bodySmall, color = tone)
    }
}

/** "u•••••@gmail.com": enough to recognise the account, not enough to read it over a shoulder. */
fun maskEmail(email: String): String {
    val at = email.indexOf('@')
    if (at < 1) return email
    return email.first() + "•••••" + email.substring(at)
}
