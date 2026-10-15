package app.sipwise.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.sipwise.ledger.Ledger
import app.sipwise.model.InboxCounts
import app.sipwise.model.InboxFilter
import app.sipwise.model.InboxItem
import app.sipwise.model.InboxView
import app.sipwise.network.ApiJson
import app.sipwise.network.ApiRequestException
import app.sipwise.session.ConflictException
import app.sipwise.session.EngineException
import app.sipwise.session.VaultLockedException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

data class InboxUi(
    val filter: InboxFilter = InboxFilter.INBOX,
    val counts: InboxCounts = InboxCounts(),
    val items: List<InboxItem> = emptyList(),
    val confirmDelete: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
)

/** The Inbox (the bell): dividend announcements and recorded payouts, with read, clear, restore and history. */
class InboxViewModel(private val ledger: Ledger) : ViewModel() {
    private val _ui = MutableStateFlow(InboxUi())
    val ui: StateFlow<InboxUi> = _ui.asStateFlow()

    init {
        viewModelScope.launch { ledger.version.collect { load() } }
    }

    private suspend fun load() {
        try {
            val view = ApiJson.decodeFromJsonElement(InboxView.serializer(), ledger.view("inbox.view", mapOf("filter" to _ui.value.filter.key)))
            _ui.value = _ui.value.copy(counts = view.counts, items = view.items)
        } catch (e: EngineException) {
            _ui.value = _ui.value.copy(error = e.message)
        }
    }

    fun setFilter(filter: InboxFilter) {
        _ui.value = _ui.value.copy(filter = filter)
        viewModelScope.launch { load() }
    }

    fun confirmDelete(open: Boolean) {
        _ui.value = _ui.value.copy(confirmDelete = open)
    }

    fun toggleRead(item: InboxItem) = change(if (item.read) "unread" else "read", item.id)

    fun clear(item: InboxItem) = change("clear", item.id)

    fun restore(item: InboxItem) = change("restore", item.id)

    fun markAll() = change("markAll")

    fun clearAll() = change("clearAll")

    fun deleteCleared() {
        confirmDelete(false)
        change("deleteCleared")
    }

    private fun change(
        action: String,
        id: String = "",
    ) {
        viewModelScope.launch {
            if (_ui.value.busy) return@launch
            _ui.value = _ui.value.copy(busy = true, error = null)
            try {
                val params =
                    buildJsonObject {
                        put("scope", ledger.scope.value)
                        put("action", action)
                        put("id", id)
                    }
                ledger.applyAccount("inbox", params, notify = false)
                _ui.value = _ui.value.copy(busy = false)
            } catch (e: EngineException) {
                fail(e.message)
            } catch (e: ConflictException) {
                fail(e.message)
            } catch (e: VaultLockedException) {
                fail(e.message)
            } catch (e: ApiRequestException) {
                fail(e.message)
            }
        }
    }

    private fun fail(message: String?) {
        _ui.value = _ui.value.copy(busy = false, error = message)
    }
}
