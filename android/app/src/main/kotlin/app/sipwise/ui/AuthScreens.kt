package app.sipwise.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.sipwise.R
import app.sipwise.designsystem.AreaChart
import app.sipwise.designsystem.BrandColors
import app.sipwise.designsystem.ChartSeries
import app.sipwise.designsystem.IconTile
import app.sipwise.designsystem.MoneyText
import app.sipwise.designsystem.Overline
import app.sipwise.designsystem.ProgressRing
import app.sipwise.designsystem.ScreenSkeleton
import app.sipwise.designsystem.SipwiseNumbers
import app.sipwise.designsystem.SlabColors
import app.sipwise.designsystem.Spacing
import app.sipwise.designsystem.StepsMark
import app.sipwise.designsystem.rememberMotionEnabled

/** The brand moment while the app works out whether you are signed in and what vault state you are in. */
@Composable
fun BrandSplash(animated: Boolean = true) {
    FirstRunScene {
        val motion = animated && rememberMotionEnabled()
        val reveal = remember { Animatable(if (motion) 0f else 1f) }
        val dot = remember { Animatable(if (motion) 0f else 1f) }
        val words = remember { Animatable(if (motion) 0f else 1f) }
        LaunchedEffect(motion) {
            if (motion) {
                reveal.animateTo(1f, tween(SPLASH_STEPS_MS, easing = FastOutSlowInEasing))
                dot.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium))
                words.animateTo(1f, tween(SPLASH_WORDS_MS))
            }
        }
        Column(
            Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Box(
                Modifier.size(120.dp).clip(RoundedCornerShape(34.dp)).background(Brush.linearGradient(listOf(Color(0xFF4C8DFF), Color(0xFF1D4ED8)))),
                contentAlignment = Alignment.Center,
            ) {
                StepsMark(Modifier.size(74.dp), reveal = reveal.value, dot = dot.value)
            }
            Spacer(Modifier.height(Spacing.xl))
            Box(
                Modifier.graphicsLayer {
                    alpha = words.value
                    translationY = (1f - words.value) * SPLASH_RISE
                },
            ) {
                Wordmark(size = 30)
            }
            Spacer(Modifier.height(Spacing.sm))
            Text(
                "Invest a step every month",
                Modifier.graphicsLayer { alpha = words.value },
                style = MaterialTheme.typography.bodyMedium,
                color = FirstRunInk.muted,
            )
            Spacer(Modifier.height(Spacing.xxl + Spacing.xl))
            LinearProgressIndicator(Modifier.width(44.dp).height(4.dp).clip(RoundedCornerShape(4.dp)), color = FirstRunInk.mint, trackColor = Color(0x1FFFFFFF))
        }
    }
}

private const val SPLASH_STEPS_MS = 800
private const val SPLASH_WORDS_MS = 450
private const val SPLASH_RISE = 24f

/** "Sipwise" with the second half in sky blue. */
@Composable
fun Wordmark(size: Int) {
    Text(
        buildAnnotatedString {
            append("Sip")
            withStyle(SpanStyle(color = Color(0xFF7DB0FF))) { append("wise") }
        },
        style = MaterialTheme.typography.headlineMedium.copy(fontSize = size.sp),
        color = FirstRunInk.text,
    )
}

/** In-app placeholder while a screen's view is still being built. */
@Composable
fun LoadingScreen() {
    ScreenSkeleton()
}

private val SampleTrend =
    listOf(3.62, 3.7, 3.66, 3.78, 3.85, 3.8, 3.95, 4.02, 3.98, 4.12, 4.2, 4.17, 4.3, 4.41, 4.38, 4.55, 4.63, 4.7, 4.83).mapIndexed { i, y -> listOf(i.toDouble(), y) }

@Composable
fun SignInScreen(
    message: String?,
    onSignIn: (android.content.Context) -> Unit,
) {
    val context = LocalContext.current
    FirstRunScene {
        val motion = rememberMotionEnabled()
        val drift = rememberInfiniteTransition(label = "aurora")
        val phase by drift.animateFloat(0f, 1f, infiniteRepeatable(tween(AURORA_MS, easing = LinearEasing), RepeatMode.Reverse), label = "aurora-phase")
        val bob by drift.animateFloat(0f, 1f, infiniteRepeatable(tween(BOB_MS, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "bob")
        val t = if (motion) phase else 0f
        Canvas(Modifier.fillMaxSize()) {
            val w = size.width
            val h = size.height * 0.62f

            fun glow(
                color: Color,
                x: Float,
                y: Float,
                r: Float,
            ) = drawCircle(Brush.radialGradient(listOf(color, Color.Transparent), Offset(x, y), r), r, Offset(x, y))
            glow(Color(0x663B82F6), w * (0.25f + 0.1f * t), h * (0.4f + 0.05f * t), w * 0.7f)
            glow(Color(0x4022E0A0), w * (0.78f - 0.08f * t), h * (0.3f + 0.08f * t), w * 0.55f)
            glow(Color(0x406366F1), w * (0.6f + 0.05f * t), h * (0.75f - 0.05f * t), w * 0.6f)
        }
        Column(
            Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).verticalScroll(rememberScrollState()),
        ) {
            Box(Modifier.fillMaxWidth().height(PREVIEW_HEIGHT.dp)) {
                val lift = if (motion) bob * BOB_DP else 0f
                PreviewCard(Modifier.offset(x = 22.dp, y = (30 + lift).dp).width(218.dp)) {
                    Overline("Net worth", color = SlabColors.muted)
                    MoneyText("Rs 4,826,310", style = SipwiseNumbers.large)
                    AreaChart(
                        series = listOf(ChartSeries(SampleTrend, SlabColors.gain, fill = true)),
                        description = "A rising sample net worth line",
                        height = 52.dp,
                        onSlab = true,
                        showAxes = false,
                    )
                }
                PreviewCard(Modifier.align(Alignment.TopEnd).offset(x = (-18).dp, y = (150 - lift).dp).width(156.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                        ProgressRing(0.64f, size = 44.dp, stroke = 5.dp)
                        Column {
                            Text("October SIP", style = MaterialTheme.typography.titleSmall, color = SlabColors.ink)
                            MoneyText("32k of 50k", style = SipwiseNumbers.tiny, color = SlabColors.muted)
                        }
                    }
                }
                PreviewCard(Modifier.offset(x = 40.dp, y = (236 + lift).dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                        IconTile(Icons.Outlined.Lock, BrandColors.mint, size = 30.dp)
                        Text("Encrypted on this phone", style = MaterialTheme.typography.titleSmall, color = SlabColors.ink)
                    }
                }
            }
            Column(Modifier.padding(horizontal = Spacing.xl).padding(bottom = Spacing.xl), verticalArrangement = Arrangement.spacedBy(Spacing.md + 2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    Box(
                        Modifier.size(32.dp).clip(RoundedCornerShape(10.dp)).background(BrandColors.button),
                        contentAlignment = Alignment.Center,
                    ) { StepsMark(Modifier.size(18.dp)) }
                    Wordmark(size = 18)
                }
                Text(
                    buildAnnotatedString {
                        append("Your PSX portfolio, ")
                        withStyle(SpanStyle(brush = Brush.linearGradient(listOf(Color(0xFF7DB0FF), FirstRunInk.mint)))) { append("one step a month.") }
                    },
                    style = MaterialTheme.typography.headlineMedium,
                    color = FirstRunInk.text,
                )
                Text(stringResource(R.string.sign_in_tagline), style = MaterialTheme.typography.bodyMedium, color = FirstRunInk.muted)
                if (message != null) NoticeCard(message)
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(54.dp)
                        .clip(RoundedCornerShape(18.dp))
                        .background(Color.White)
                        .clickable(role = Role.Button) { onSignIn(context) },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                ) {
                    Image(painterResource(R.drawable.ic_google_g), contentDescription = null, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(Spacing.md))
                    Text(stringResource(R.string.sign_in_google), style = MaterialTheme.typography.titleMedium, color = Color(0xFF1F1F1F))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.Top) {
                    Icon16Lock()
                    Text(stringResource(R.string.sign_in_privacy), style = MaterialTheme.typography.bodySmall, color = FirstRunInk.muted, textAlign = TextAlign.Start)
                }
            }
        }
    }
}

private const val AURORA_MS = 14_000
private const val BOB_MS = 3_200
private const val BOB_DP = 5f
private const val PREVIEW_HEIGHT = 330

@Composable
private fun Icon16Lock() {
    Icon(Icons.Outlined.Lock, contentDescription = null, tint = FirstRunInk.mint, modifier = Modifier.size(16.dp))
}

/** A frosted "preview of the app" card on the sign-in screen. */
@Composable
private fun PreviewCard(
    modifier: Modifier,
    content: @Composable () -> Unit,
) {
    val shape = RoundedCornerShape(20.dp)
    Column(
        modifier.clip(shape).background(Color(0xB80E1630)).border(1.dp, Color(0x17FFFFFF), shape).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) { content() }
}
