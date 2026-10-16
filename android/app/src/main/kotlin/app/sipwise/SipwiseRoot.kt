package app.sipwise

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.List
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.PieChart
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material3.AssistChip
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavDestination
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import app.sipwise.analytics.Analytics
import app.sipwise.auth.AuthState
import app.sipwise.auth.AuthViewModel
import app.sipwise.designsystem.BrandColors
import app.sipwise.designsystem.FloatingNavBar
import app.sipwise.designsystem.NavItemSpec
import app.sipwise.designsystem.Spacing
import app.sipwise.ledger.Ledger
import app.sipwise.ledger.LedgerAction
import app.sipwise.ledger.LedgerNotice
import app.sipwise.model.ALL_PORTFOLIOS
import app.sipwise.model.DeepLinkTarget
import app.sipwise.model.EntryKind
import app.sipwise.network.Events
import app.sipwise.network.MeResponse
import app.sipwise.session.ConflictException
import app.sipwise.ui.ActivityScreen
import app.sipwise.ui.ActivityViewModel
import app.sipwise.ui.BrandSplash
import app.sipwise.ui.CompanyScreen
import app.sipwise.ui.CompanyViewModel
import app.sipwise.ui.EntryScreen
import app.sipwise.ui.EntryViewModel
import app.sipwise.ui.EraseVaultScreen
import app.sipwise.ui.HoldingsScreen
import app.sipwise.ui.HoldingsViewModel
import app.sipwise.ui.InboxBell
import app.sipwise.ui.InboxScreen
import app.sipwise.ui.InboxViewModel
import app.sipwise.ui.InsightsScreen
import app.sipwise.ui.InsightsViewModel
import app.sipwise.ui.MoreScreen
import app.sipwise.ui.PicksScreen
import app.sipwise.ui.PicksViewModel
import app.sipwise.ui.PlanScreen
import app.sipwise.ui.PlanViewModel
import app.sipwise.ui.PortfoliosScreen
import app.sipwise.ui.PortfoliosViewModel
import app.sipwise.ui.PushViewModel
import app.sipwise.ui.RecoverScreen
import app.sipwise.ui.RecoveryKeyScreen
import app.sipwise.ui.ScopeViewModel
import app.sipwise.ui.SettingsViewModel
import app.sipwise.ui.SignInScreen
import app.sipwise.ui.TargetsScreen
import app.sipwise.ui.TargetsViewModel
import app.sipwise.ui.TodayScreen
import app.sipwise.ui.TodayViewModel
import app.sipwise.ui.UnlockScreen
import app.sipwise.ui.UpdatePrompt
import app.sipwise.ui.VaultFailedScreen
import app.sipwise.ui.VaultSetupScreen
import app.sipwise.ui.findFragmentActivity
import app.sipwise.update.UpdateViewModel
import app.sipwise.vault.VaultUi
import app.sipwise.vault.VaultViewModel
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/** Type-safe top-level routes. The four destinations match the Expo app's tabs. */
@Serializable object Today

@Serializable object Portfolio

@Serializable object Plan

@Serializable object Activity

@Serializable object More

@Serializable data class AddEntry(
    val entryId: String? = null,
    val ticker: String? = null,
    val shares: String? = null,
    val price: String? = null,
    val month: String? = null,
)

@Serializable object Targets

@Serializable object Portfolios

@Serializable object Inbox

@Serializable object Insights

@Serializable data class Picks(val month: String)

@Serializable data class CompanyRoute(val ticker: String)

/** The navigation route for a link target. */
private fun routeFor(target: DeepLinkTarget): Any =
    when (target) {
        DeepLinkTarget.Today -> Today
        DeepLinkTarget.Portfolio -> Portfolio
        DeepLinkTarget.Plan -> Plan
        DeepLinkTarget.Activity -> Activity
        DeepLinkTarget.More -> More
        DeepLinkTarget.Inbox -> Inbox
        DeepLinkTarget.Insights -> Insights
        DeepLinkTarget.Targets -> Targets
        DeepLinkTarget.Picks -> Plan
        is DeepLinkTarget.Company -> CompanyRoute(target.ticker)
    }

/** The catalog name of a screen for usage events, or null for screens the catalog does not list. */
private fun screenName(destination: NavDestination?): String? =
    when {
        destination == null -> null
        destination.hasRoute(Today::class) -> "today"
        destination.hasRoute(Portfolio::class) -> "portfolio"
        destination.hasRoute(Plan::class) -> "plan"
        destination.hasRoute(Activity::class) -> "activity"
        destination.hasRoute(More::class) -> "more"
        destination.hasRoute(CompanyRoute::class) -> "company"
        destination.hasRoute(Inbox::class) -> "inbox"
        destination.hasRoute(Insights::class) -> "reports"
        else -> null
    }

private data class TopLevel(val route: Any, val label: Int, val icon: ImageVector)

private val barItems =
    listOf(
        TopLevel(Today, R.string.nav_today, Icons.Outlined.Home),
        TopLevel(Portfolio, R.string.nav_portfolio, Icons.Outlined.PieChart),
        TopLevel(Plan, R.string.nav_plan, Icons.Outlined.Timeline),
        TopLevel(Activity, R.string.nav_activity, Icons.Outlined.List),
    )

private val topLevel =
    listOf(
        TopLevel(Today, R.string.nav_today, Icons.Outlined.Home),
        TopLevel(Portfolio, R.string.nav_portfolio, Icons.Outlined.PieChart),
        TopLevel(Plan, R.string.nav_plan, Icons.Outlined.Timeline),
        TopLevel(Activity, R.string.nav_activity, Icons.Outlined.List),
        TopLevel(More, R.string.nav_more, Icons.Outlined.MoreHoriz),
    )

@Composable
fun SipwiseRoot() {
    val auth: AuthViewModel = viewModel()
    val state by auth.state.collectAsStateWithLifecycle()
    val message by auth.message.collectAsStateWithLifecycle()
    val analytics = (LocalContext.current.applicationContext as SipwiseApp).container.analytics
    LaunchedEffect(state) { analytics.setSignedIn(state is AuthState.SignedIn) }
    when (val current = state) {
        AuthState.Loading -> BrandSplash()
        AuthState.SignedOut -> SignInScreen(message, onSignIn = auth::signIn)
        is AuthState.SignedIn -> VaultGate(current.user, onSignOut = auth::signOut, onAccountDeleted = auth::accountDeleted)
    }
}

@Composable
private fun VaultGate(
    user: MeResponse,
    onSignOut: () -> Unit,
    onAccountDeleted: () -> Unit,
) {
    val email = user.email
    val app = LocalContext.current.applicationContext as Application
    val vault: VaultViewModel =
        viewModel(
            key = email,
            factory = viewModelFactory { initializer { VaultViewModel(app, email) } },
        )
    val ui by vault.ui.collectAsStateWithLifecycle()
    val busy by vault.busy.collectAsStateWithLifecycle()
    val error by vault.error.collectAsStateWithLifecycle()
    var recovering by remember { mutableStateOf(false) }
    var erasing by remember { mutableStateOf(false) }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { vault.onBackgrounded(System.currentTimeMillis()) }
    LifecycleEventEffect(Lifecycle.Event.ON_START) { vault.onForegrounded(System.currentTimeMillis()) }
    when (val current = ui) {
        VaultUi.Checking -> BrandSplash(animated = false)
        is VaultUi.Failed -> VaultFailedScreen(current.message, onRetry = vault::refresh, onSignOut = onSignOut)
        VaultUi.NeedsSetup -> VaultSetupScreen(email, busy, error, onCreate = vault::startSetup)
        is VaultUi.ConfirmRecovery ->
            RecoveryKeyScreen(current.recoveryKey, busy, error, onSaved = vault::confirmRecoverySaved, onCancel = vault::cancelSetup)
        is VaultUi.Locked ->
            if (erasing) {
                EraseVaultScreen(email, busy, error, onErase = vault::erase, onBack = { erasing = false })
            } else if (recovering) {
                RecoverScreen(busy, error, onRecover = vault::recover, onBack = { recovering = false })
            } else {
                val biometric by vault.biometric.collectAsStateWithLifecycle()
                val activity = LocalContext.current.findFragmentActivity()
                val stage by vault.stage.collectAsStateWithLifecycle()
                UnlockScreen(
                    email,
                    current.offline,
                    busy,
                    stage,
                    error,
                    biometric,
                    onUnlock = { password, remember -> vault.unlock(password, remember, activity) },
                    onBiometric = { activity?.let(vault::unlockWithBiometric) },
                    onForgot = { recovering = true },
                    onErase = { erasing = true },
                    onSignOut = onSignOut,
                )
            }
        is VaultUi.Unlocked ->
            PrivacyCover {
                MainShell(current, vault, user, onLock = vault::lock, onSignOut = onSignOut, onAccountDeleted = onAccountDeleted)
            }
    }
}

/** Covers the portfolio the moment the app leaves the foreground, so the recents thumbnail never shows it. */
@Composable
private fun PrivacyCover(content: @Composable () -> Unit) {
    val state by LocalLifecycleOwner.current.lifecycle.currentStateFlow.collectAsStateWithLifecycle()
    Box(Modifier.fillMaxSize()) {
        content()
        if (!state.isAtLeast(Lifecycle.State.RESUMED)) BrandSplash(animated = false)
    }
}

/** Turns a saved change into its usage event (feature names only; never a ticker or an amount). */
private fun trackNotice(
    analytics: Analytics,
    notice: LedgerNotice,
) {
    val kind = notice.kind?.wire ?: "other"
    when (notice.action) {
        LedgerAction.ENTRY -> analytics.track(Events.ENTRY_ADDED, "kind" to kind)
        LedgerAction.BUYS -> analytics.track(Events.ENTRY_ADDED, "kind" to "buy")
        LedgerAction.CORRECTION -> analytics.track(Events.ENTRY_EDITED, "kind" to kind)
        LedgerAction.VOID -> analytics.track(Events.ENTRY_DELETED, "kind" to kind)
        LedgerAction.TARGETS -> analytics.track(Events.TARGETS_SAVED)
        LedgerAction.PICKS -> analytics.track(Events.PICKS_COMPLETED)
        else -> Unit
    }
}

/** Shows the "Recorded ... Undo" snackbar for each change the ledger reports, and performs the undo. */
@Composable
private fun LedgerNotices(
    ledger: Ledger,
    snackbar: SnackbarHostState,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val analytics = (context.applicationContext as SipwiseApp).container.analytics
    LaunchedEffect(ledger) {
        ledger.notices.collect { notice ->
            trackNotice(analytics, notice)
            haptics.performHapticFeedback(HapticFeedbackType.Confirm)
            val kind = notice.kind?.let { context.getString(entryKindLabel(it)) } ?: ""
            val result =
                snackbar.showSnackbar(
                    message =
                        when (notice.action) {
                            LedgerAction.ENTRY -> context.getString(R.string.entry_recorded, kind, notice.ticker)
                            LedgerAction.PRICE -> context.getString(R.string.notice_price, notice.ticker)
                            LedgerAction.RECEIVED -> context.getString(R.string.notice_received, notice.ticker)
                            LedgerAction.VOID -> context.getString(R.string.notice_void, notice.ticker)
                            LedgerAction.BUYS -> context.getString(R.string.notice_buys, notice.ticker)
                            LedgerAction.BUDGET -> context.getString(R.string.notice_budget, notice.ticker)
                            LedgerAction.TARGETS -> context.getString(R.string.notice_targets)
                            LedgerAction.TAX -> context.getString(R.string.notice_tax)
                            LedgerAction.PORTFOLIOS -> context.getString(R.string.notice_portfolios)
                            LedgerAction.PICKS -> context.getString(R.string.notice_picks)
                            LedgerAction.CORRECTION -> context.getString(R.string.notice_correction, notice.ticker)
                        },
                    actionLabel = context.getString(R.string.entry_undo),
                    duration = SnackbarDuration.Long,
                )
            if (result == SnackbarResult.ActionPerformed) {
                scope.launch {
                    val message =
                        try {
                            ledger.undo(notice.change)
                            context.getString(R.string.entry_undone)
                        } catch (e: ConflictException) {
                            e.message.orEmpty()
                        }
                    snackbar.showSnackbar(message)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainShell(
    unlocked: VaultUi.Unlocked,
    vault: VaultViewModel,
    user: MeResponse,
    onLock: () -> Unit,
    onSignOut: () -> Unit,
    onAccountDeleted: () -> Unit,
) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val holdings: HoldingsViewModel =
        viewModel(factory = viewModelFactory { initializer { HoldingsViewModel(unlocked.ledger) } })
    val today: TodayViewModel =
        viewModel(factory = viewModelFactory { initializer { TodayViewModel(unlocked.ledger) } })
    val activity: ActivityViewModel =
        viewModel(factory = viewModelFactory { initializer { ActivityViewModel(unlocked.ledger) } })
    val plan: PlanViewModel =
        viewModel(factory = viewModelFactory { initializer { PlanViewModel(unlocked.ledger) } })
    val inbox: InboxViewModel =
        viewModel(factory = viewModelFactory { initializer { InboxViewModel(unlocked.ledger) } })
    val inboxUi by inbox.ui.collectAsStateWithLifecycle()
    val scopes: ScopeViewModel =
        viewModel(factory = viewModelFactory { initializer { ScopeViewModel(unlocked.ledger) } })
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val api = (context.applicationContext as SipwiseApp).container.api
    LedgerNotices(unlocked.ledger, snackbar)
    val updates: UpdateViewModel = viewModel()
    UpdatePrompt(updates, includePrereleases = user.role == "super_admin")
    val container = (context.applicationContext as SipwiseApp).container
    val analytics = container.analytics
    val link by container.pendingLink.collectAsStateWithLifecycle()
    LaunchedEffect(link) {
        link?.let { nav.navigate(routeFor(it)) { launchSingleTop = true } }
        container.pendingLink.value = null
    }
    LaunchedEffect(Unit) { analytics.track(Events.APP_OPENED) }
    LaunchedEffect(entry?.destination?.route) { screenName(entry?.destination)?.let { analytics.track(Events.SCREEN_VIEWED, "screen" to it) } }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { scope.launch { unlocked.ledger.refreshPublic() } }
    LaunchedEffect(Unit) { (context.applicationContext as SipwiseApp).container.syncPush() }
    val onAddScreen = entry?.destination?.hasRoute(AddEntry::class) == true || entry?.destination?.hasRoute(Targets::class) == true
    val noAddButton = listOf(CompanyRoute::class, More::class, Portfolios::class, Picks::class, Inbox::class, Insights::class).any { entry?.destination?.hasRoute(it) == true }
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            val destination = entry?.destination
            val top = topLevel.firstOrNull { destination?.hasRoute(it.route::class) == true }
            when {
                top != null ->
                    TopAppBar(
                        title = { Text(stringResource(top.label), style = MaterialTheme.typography.headlineSmall, maxLines = 1, softWrap = false) },
                        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                        actions = {
                            if (top.route != More && top.route != Plan) ScopeChooser(scopes)
                            InboxBell(inboxUi.counts.unread) { nav.navigate(Inbox) }
                            if (top.route != More) AvatarButton(user) { nav.navigate(More) { launchSingleTop = true } }
                        },
                    )
                destination != null ->
                    TopAppBar(
                        title = { Text(subScreenTitle(destination, entry)) },
                        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                        navigationIcon = {
                            IconButton(onClick = { nav.popBackStack() }) {
                                Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = stringResource(R.string.nav_back))
                            }
                        },
                    )
            }
        },
        bottomBar = {
            if (!onAddScreen) {
                val specs =
                    barItems.map { item ->
                        NavItemSpec(
                            label = stringResource(item.label),
                            icon = item.icon,
                            selected = entry?.destination?.hasRoute(item.route::class) == true,
                            onClick = {
                                nav.navigate(item.route) {
                                    popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                        )
                    }
                FloatingNavBar(
                    left = specs.take(2),
                    right = specs.drop(2),
                    addDescription = stringResource(R.string.entry_title),
                    onAdd = { nav.navigate(AddEntry()) },
                    showAdd = !noAddButton,
                )
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = Today, modifier = Modifier.padding(padding)) {
            composable<Today> {
                TodayScreen(
                    today,
                    onOpenCompany = { nav.navigate(CompanyRoute(it)) },
                    onOpenTargets = { nav.navigate(Targets) },
                    onAddEntry = { nav.navigate(AddEntry()) },
                    onOpenPortfolio = {
                        nav.navigate(Portfolio) {
                            popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    },
                    onOpenPlan = {
                        nav.navigate(Plan) {
                            popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    },
                )
            }
            composable<Portfolio> { HoldingsScreen(holdings, onOpenCompany = { nav.navigate(CompanyRoute(it)) }, onOpenInsights = { nav.navigate(Insights) }) }
            composable<Plan> { PlanScreen(plan, onEditTargets = { nav.navigate(Targets) }, onOpenPicks = { nav.navigate(Picks(it)) }) }
            composable<Insights> {
                val insights: InsightsViewModel =
                    viewModel(factory = viewModelFactory { initializer { InsightsViewModel(unlocked.ledger, api) } })
                InsightsScreen(insights, onOpenCompany = { nav.navigate(CompanyRoute(it)) })
            }
            composable<Inbox> { InboxScreen(inbox, onOpenCompany = { nav.navigate(CompanyRoute(it)) }) }
            composable<Picks> { backStack ->
                val month = backStack.toRoute<Picks>().month
                val picks: PicksViewModel =
                    viewModel(key = "picks-$month", factory = viewModelFactory { initializer { PicksViewModel(unlocked.ledger, api, month) } })
                PicksScreen(
                    picks,
                    onRecordOne = { ticker, shares, price -> nav.navigate(AddEntry(ticker = ticker, shares = shares, price = price, month = month)) },
                )
            }
            composable<Portfolios> {
                val portfolios: PortfoliosViewModel =
                    viewModel(factory = viewModelFactory { initializer { PortfoliosViewModel(unlocked.ledger) } })
                PortfoliosScreen(portfolios)
            }
            composable<Targets> {
                val targets: TargetsViewModel =
                    viewModel(factory = viewModelFactory { initializer { TargetsViewModel(unlocked.ledger) } })
                TargetsScreen(targets, onDone = { nav.popBackStack() })
            }
            composable<Activity> { ActivityScreen(activity, onOpenEntry = { id -> nav.navigate(AddEntry(entryId = id)) }) }
            composable<More> {
                val settings: SettingsViewModel =
                    viewModel(factory = viewModelFactory { initializer { SettingsViewModel(context.applicationContext as Application, unlocked.ledger, unlocked.session) } })
                val push: PushViewModel = viewModel()
                MoreScreen(settings, push, vault, unlocked.session, user, onLock, onSignOut, onAccountDeleted, onManagePortfolios = { nav.navigate(Portfolios) }, updates = updates)
            }
            composable<CompanyRoute> { backStack ->
                val ticker = backStack.toRoute<CompanyRoute>().ticker
                val company: CompanyViewModel =
                    viewModel(
                        key = ticker,
                        factory = viewModelFactory { initializer { CompanyViewModel(unlocked.ledger, api, ticker) } },
                    )
                CompanyScreen(company, onOpenEntry = { id -> nav.navigate(AddEntry(entryId = id)) }, onAdd = { nav.navigate(AddEntry(ticker = ticker)) })
            }
            composable<AddEntry> {
                val route = it.toRoute<AddEntry>()
                val form: EntryViewModel =
                    viewModel(
                        key = "${route.entryId}/${route.ticker}/${route.shares}/${route.price}/${route.month}",
                        factory =
                            viewModelFactory {
                                initializer {
                                    EntryViewModel(
                                        unlocked.ledger,
                                        editId = route.entryId,
                                        initialTicker = route.ticker.orEmpty(),
                                        initialShares = route.shares.orEmpty(),
                                        initialPrice = route.price.orEmpty(),
                                        initialMonth = route.month.orEmpty(),
                                    )
                                }
                            },
                    )
                EntryScreen(form, onDone = { nav.popBackStack() })
            }
        }
    }
}

/** The account button in the top bar: your initial on a brand gradient, opens More. */
@Composable
private fun AvatarButton(
    user: MeResponse,
    onClick: () -> Unit,
) {
    val initial = (user.name ?: user.email).firstOrNull()?.uppercaseChar()?.toString().orEmpty()
    Box(
        Modifier.padding(end = Spacing.sm).size(32.dp).clip(CircleShape).background(BrandColors.button).clickable(onClickLabel = stringResource(R.string.nav_more), onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(initial, style = MaterialTheme.typography.labelLarge, color = Color.White)
    }
}

@Composable
private fun subScreenTitle(
    destination: NavDestination,
    entry: NavBackStackEntry?,
): String =
    when {
        destination.hasRoute(CompanyRoute::class) -> entry?.toRoute<CompanyRoute>()?.ticker.orEmpty()
        destination.hasRoute(Targets::class) -> stringResource(R.string.targets_title)
        destination.hasRoute(Portfolios::class) -> stringResource(R.string.portfolios_title)
        destination.hasRoute(Picks::class) -> stringResource(R.string.picks_title)
        destination.hasRoute(Inbox::class) -> stringResource(R.string.inbox_title)
        destination.hasRoute(Insights::class) -> stringResource(R.string.insights_title)
        destination.hasRoute(AddEntry::class) ->
            stringResource(if (entry?.toRoute<AddEntry>()?.entryId != null) R.string.entry_edit_title else R.string.entry_title)
        else -> ""
    }

private val SCOPE_CHIP_MAX = 128.dp

@Composable
private fun ScopeChooser(scopes: ScopeViewModel) {
    val list by scopes.portfolios.collectAsStateWithLifecycle()
    val selected by scopes.selected.collectAsStateWithLifecycle()
    if (list.size < 2) return
    var open by remember { mutableStateOf(false) }
    val label = list.firstOrNull { it.id == selected }?.name ?: stringResource(R.string.scope_all)
    Box {
        AssistChip(
            onClick = { open = true },
            label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = SCOPE_CHIP_MAX)) },
            modifier = Modifier.padding(end = Spacing.sm),
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.scope_all)) },
                onClick = {
                    scopes.select(ALL_PORTFOLIOS)
                    open = false
                },
            )
            for (portfolio in list) {
                DropdownMenuItem(
                    text = {
                        Column {
                            Text(portfolio.name)
                            Text(portfolio.contents, style = MaterialTheme.typography.bodySmall)
                        }
                    },
                    onClick = {
                        scopes.select(portfolio.id)
                        open = false
                    },
                )
            }
        }
    }
}

private fun entryKindLabel(kind: EntryKind) =
    when (kind) {
        EntryKind.BUY -> R.string.entry_kind_buy
        EntryKind.SELL -> R.string.entry_kind_sell
        EntryKind.OPENING -> R.string.entry_kind_opening
        EntryKind.DIVIDEND -> R.string.entry_kind_dividend
        EntryKind.SPLIT -> R.string.entry_kind_split
    }
