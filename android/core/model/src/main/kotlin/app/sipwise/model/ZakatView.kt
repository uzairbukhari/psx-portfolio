package app.sipwise.model

import kotlinx.serialization.Serializable

@Serializable
data class ZakatKind(val key: String, val label: String)

@Serializable
data class ZakatKinds(val manual: List<ZakatKind> = emptyList(), val payment: List<String> = emptyList())

@Serializable
data class ZakatSettingsView(val startDate: String = "", val school: String = "hanafi", val year: String = "lunar", val nisab: String = "silver", val shares: String = "market")

@Serializable
data class ZakatItemView(val id: String, val kind: String, val label: String, val amount: Double, val asOf: String = "", val note: String = "")

@Serializable
data class ZakatPaymentView(val id: String, val date: String, val amount: Double, val kind: String, val note: String = "")

@Serializable
data class ZakatRowView(val key: String, val label: String, val detail: String = "", val value: Double, val counted: Double, val kind: String)

@Serializable
data class ZakatNisabView(val value: Double, val basis: String = "silver")

@Serializable
data class ZakatBreakdownView(
    val rows: List<ZakatRowView> = emptyList(),
    val gross: Double = 0.0,
    val debts: Double = 0.0,
    val net: Double = 0.0,
    val nisab: ZakatNisabView = ZakatNisabView(0.0),
    val aboveNisab: Boolean = false,
    val zakat: Double = 0.0,
    val otherMethodZakat: Double? = null,
    val missing: List<String> = emptyList(),
)

@Serializable
data class ZakatPastYear(val id: String, val name: String, val due: String, val amountDue: Double, val paid: Double, val remaining: Double)

@Serializable
data class ZakatProgressView(
    val name: String = "",
    val estimate: Double = 0.0,
    val paid: Double = 0.0,
    val remaining: Double = 0.0,
    val extra: Double = 0.0,
    val percentPaid: Double = 0.0,
    val daysLeft: Int = 0,
    val closeDue: Boolean = false,
    val past: List<ZakatPastYear> = emptyList(),
    val arrears: Double = 0.0,
)

@Serializable
data class ZakatReminderView(val id: String, val date: String, val title: String, val body: String)

/** The Zakat screen, exactly as `zakat.view` in the shared engine works it out. */
@Serializable
data class ZakatView(
    val setup: Boolean = false,
    val asOf: String = "",
    val canLog: Boolean = true,
    val hijri: String = "",
    val kinds: ZakatKinds = ZakatKinds(),
    val settings: ZakatSettingsView = ZakatSettingsView(),
    val items: List<ZakatItemView> = emptyList(),
    val payments: List<ZakatPaymentView> = emptyList(),
    val breakdown: ZakatBreakdownView = ZakatBreakdownView(),
    val progress: ZakatProgressView = ZakatProgressView(),
    val dueDate: String = "",
    val dueHijri: String = "",
    val recordTrail: Boolean = false,
    val lockPending: Boolean = false,
    val reminders: List<ZakatReminderView> = emptyList(),
)
