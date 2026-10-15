package app.sipwise

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.List
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.PieChart
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material3.AssistChip
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
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
import app.sipwise.auth.AuthState
import app.sipwise.auth.AuthViewModel
import app.sipwise.designsystem.Spacing
import app.sipwise.ledger.Ledger
import app.sipwise.ledger.LedgerAction
import app.sipwise.model.ALL_PORTFOLIOS
import app.sipwise.model.EntryKind
import app.sipwise.network.MeResponse
import app.sipwise.session.ConflictException
import app.sipwise.ui.ActivityScreen
import app.sipwise.ui.ActivityViewModel
import app.sipwise.ui.CompanyScreen
import app.sipwise.ui.CompanyViewModel
import app.sipwise.ui.EntryScreen
import app.sipwise.ui.EntryViewModel
import app.sipwise.ui.HoldingsScreen
import app.sipwise.ui.HoldingsViewModel
import app.sipwise.ui.LoadingScreen
import app.sipwise.ui.MoreScreen
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
import app.sipwise.ui.VaultFailedScreen
import app.sipwise.ui.VaultSetupScreen
import app.sipwise.ui.findFragmentActivity
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

@Serializable data class AddEntry(val entryId: String? = null, val ticker: String? = null)

@Serializable object Targets

@Serializable object Portfolios

@Serializable data class CompanyRoute(val ticker: String)

private data class TopLevel(val route: Any, val label: Int, val icon: ImageVector)

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
    when (val current = state) {
        AuthState.Loading -> LoadingScreen()
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
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { vault.onBackgrounded(System.currentTimeMillis()) }
    LifecycleEventEffect(Lifecycle.Event.ON_START) { vault.onForegrounded(System.currentTimeMillis()) }
    when (val current = ui) {
        VaultUi.Checking -> LoadingScreen()
        is VaultUi.Failed -> VaultFailedScreen(current.message, onRetry = vault::refresh, onSignOut = onSignOut)
        VaultUi.NeedsSetup -> VaultSetupScreen(busy, error, onCreate = vault::startSetup)
        is VaultUi.ConfirmRecovery ->
            RecoveryKeyScreen(current.recoveryKey, busy, error, onSaved = vault::confirmRecoverySaved, onCancel = vault::cancelSetup)
        is VaultUi.Locked ->
            if (recovering) {
                RecoverScreen(busy, error, onRecover = vault::recover, onBack = { recovering = false })
            } else {
                val biometric by vault.biometric.collectAsStateWithLifecycle()
                val activity = LocalContext.current.findFragmentActivity()
                UnlockScreen(
                    current.offline,
                    busy,
                    error,
                    biometric,
                    onUnlock = { password, remember -> vault.unlock(password, remember, activity) },
                    onBiometric = { activity?.let(vault::unlockWithBiometric) },
                    onForgot = { recovering = true },
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
        if (!state.isAtLeast(Lifecycle.State.RESUMED)) {
            Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentAlignment = Alignment.Center) {
                Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineMedium)
            }
        }
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
    LaunchedEffect(ledger) {
        ledger.notices.collect { notice ->
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
    val scopes: ScopeViewModel =
        viewModel(factory = viewModelFactory { initializer { ScopeViewModel(unlocked.ledger) } })
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val api = (context.applicationContext as SipwiseApp).container.api
    LedgerNotices(unlocked.ledger, snackbar)
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { scope.launch { unlocked.ledger.refreshPublic() } }
    LaunchedEffect(Unit) { (context.applicationContext as SipwiseApp).container.syncPush() }
    val onAddScreen = entry?.destination?.hasRoute(AddEntry::class) == true || entry?.destination?.hasRoute(Targets::class) == true
    val noAddButton = listOf(CompanyRoute::class, More::class, Portfolios::class).any { entry?.destination?.hasRoute(it) == true }
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            val destination = entry?.destination
            val top = topLevel.firstOrNull { destination?.hasRoute(it.route::class) == true }
            when {
                top != null ->
                    TopAppBar(
                        title = { Text(stringResource(top.label)) },
                        actions = { if (top.route != More && top.route != Plan) ScopeChooser(scopes) },
                    )
                destination != null ->
                    TopAppBar(
                        title = { Text(subScreenTitle(destination, entry)) },
                        navigationIcon = {
                            IconButton(onClick = { nav.popBackStack() }) {
                                Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = stringResource(R.string.nav_back))
                            }
                        },
                    )
            }
        },
        floatingActionButton = {
            if (!onAddScreen && !noAddButton) {
                FloatingActionButton(onClick = { nav.navigate(AddEntry()) }) {
                    Icon(Icons.Outlined.Add, contentDescription = stringResource(R.string.entry_title))
                }
            }
        },
        bottomBar = {
            if (!onAddScreen) {
                NavigationBar {
                    for (item in topLevel) {
                        NavigationBarItem(
                            selected = entry?.destination?.hasRoute(item.route::class) == true,
                            onClick = {
                                nav.navigate(item.route) {
                                    popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(item.icon, contentDescription = null) },
                            label = { Text(stringResource(item.label)) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = Today, modifier = Modifier.padding(padding)) {
            composable<Today> { TodayScreen(today) }
            composable<Portfolio> { HoldingsScreen(holdings, onOpenCompany = { nav.navigate(CompanyRoute(it)) }) }
            composable<Plan> { PlanScreen(plan, onEditTargets = { nav.navigate(Targets) }) }
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
                MoreScreen(settings, push, vault, unlocked.session, user, onLock, onSignOut, onAccountDeleted, onManagePortfolios = { nav.navigate(Portfolios) })
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
                        key = "${route.entryId}/${route.ticker}",
                        factory = viewModelFactory { initializer { EntryViewModel(unlocked.ledger, editId = route.entryId, initialTicker = route.ticker.orEmpty()) } },
                    )
                EntryScreen(form, onDone = { nav.popBackStack() })
            }
        }
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
        destination.hasRoute(AddEntry::class) ->
            stringResource(if (entry?.toRoute<AddEntry>()?.entryId != null) R.string.entry_edit_title else R.string.entry_title)
        else -> ""
    }

@Composable
private fun ScopeChooser(scopes: ScopeViewModel) {
    val list by scopes.portfolios.collectAsStateWithLifecycle()
    val selected by scopes.selected.collectAsStateWithLifecycle()
    if (list.size < 2) return
    var open by remember { mutableStateOf(false) }
    val label = list.firstOrNull { it.id == selected }?.name ?: stringResource(R.string.scope_all)
    Box {
        AssistChip(onClick = { open = true }, label = { Text(label) }, modifier = Modifier.padding(end = Spacing.sm))
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
