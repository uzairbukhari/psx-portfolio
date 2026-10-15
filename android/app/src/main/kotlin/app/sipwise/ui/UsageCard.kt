package app.sipwise.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import app.sipwise.R
import app.sipwise.SipwiseApp
import app.sipwise.network.ApiRequestException
import app.sipwise.network.UsageResponse

/** This month's AI spend, shown only when the server has a figure (no private data ever goes to an AI provider). */
@Composable
fun UsageCard() {
    val api = (LocalContext.current.applicationContext as SipwiseApp).container.api
    val usage by produceState<UsageResponse?>(null) {
        value =
            try {
                api.get("/api/usage", UsageResponse.serializer())
            } catch (ignored: ApiRequestException) {
                null
            }
    }
    val data = usage ?: return
    SectionCard(R.string.settings_usage) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.settings_usage_spent, data.costUsd), style = MaterialTheme.typography.bodyLarge)
            Text(stringResource(R.string.settings_usage_tokens, data.inputTokens + data.outputTokens), style = MaterialTheme.typography.bodyLarge)
        }
    }
}
