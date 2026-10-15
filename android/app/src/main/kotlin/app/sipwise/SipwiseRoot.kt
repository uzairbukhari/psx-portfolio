package app.sipwise

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.List
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.PieChart
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import app.sipwise.auth.AuthState
import app.sipwise.auth.AuthViewModel
import app.sipwise.model.EntryKind
import app.sipwise.session.ConflictException
import app.sipwise.ui.ActivityScreen
import app.sipwise.ui.ActivityViewModel
import app.sipwise.ui.EntryScreen
import app.sipwise.ui.EntryViewModel
import app.sipwise.ui.HoldingsScreen
import app.sipwise.ui.HoldingsViewModel
import app.sipwise.ui.LoadingScreen
import app.sipwise.ui.MoreScreen
import app.sipwise.ui.RecoverScreen
import app.sipwise.ui.RecoveryKeyScreen
import app.sipwise.ui.SignInScreen
import app.sipwise.ui.TodayScreen
import app.sipwise.ui.TodayViewModel
import app.sipwise.ui.UnlockScreen
import app.sipwise.ui.VaultFailedScreen
import app.sipwise.ui.VaultSetupScreen
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

@Serializable object AddEntry

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
        is AuthState.SignedIn -> VaultGate(current.user.email, onSignOut = auth::signOut)
    }
}

@Composable
private fun VaultGate(
    email: String,
    onSignOut: () -> Unit,
) {
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
                UnlockScreen(current.offline, busy, error, onUnlock = vault::unlock, onForgot = { recovering = true }, onSignOut = onSignOut)
            }
        is VaultUi.Unlocked -> MainShell(current, onLock = vault::lock, onSignOut = onSignOut)
    }
}

@Composable
private fun MainShell(
    unlocked: VaultUi.Unlocked,
    onLock: () -> Unit,
    onSignOut: () -> Unit,
) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val holdings: HoldingsViewModel =
        viewModel(factory = viewModelFactory { initializer { HoldingsViewModel(unlocked.ledger) } })
    val today: TodayViewModel =
        viewModel(factory = viewModelFactory { initializer { TodayViewModel(unlocked.ledger) } })
    val activity: ActivityViewModel =
        viewModel(factory = viewModelFactory { initializer { ActivityViewModel(unlocked.ledger) } })
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    LaunchedEffect(unlocked.ledger) {
        unlocked.ledger.notices.collect { notice ->
            val kind = notice.kind?.let { context.getString(entryKindLabel(it)) } ?: ""
            val result =
                snackbar.showSnackbar(
                    message = context.getString(R.string.entry_recorded, kind, notice.ticker),
                    actionLabel = context.getString(R.string.entry_undo),
                    duration = SnackbarDuration.Long,
                )
            if (result == SnackbarResult.ActionPerformed) {
                scope.launch {
                    val message =
                        try {
                            unlocked.ledger.undo(notice.change)
                            context.getString(R.string.entry_undone)
                        } catch (e: ConflictException) {
                            e.message.orEmpty()
                        }
                    snackbar.showSnackbar(message)
                }
            }
        }
    }
    val onAddScreen = entry?.destination?.hasRoute(AddEntry::class) == true
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            if (!onAddScreen && entry?.destination?.hasRoute(More::class) != true) {
                FloatingActionButton(onClick = { nav.navigate(AddEntry) }) {
                    Icon(Icons.Outlined.Add, contentDescription = stringResource(R.string.entry_title))
                }
            }
        },
        bottomBar = {
            if (!onAddScreen) NavigationBar {
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
        },
    ) { padding ->
        NavHost(nav, startDestination = Today, modifier = Modifier.padding(padding)) {
            composable<Today> { TodayScreen(today) }
            composable<Portfolio> { HoldingsScreen(holdings, onOpenCompany = {}) }
            composable<Plan> { Placeholder(R.string.nav_plan) }
            composable<Activity> { ActivityScreen(activity) }
            composable<More> { MoreScreen(onLock, onSignOut) }
            composable<AddEntry> {
                val form: EntryViewModel =
                    viewModel(factory = viewModelFactory { initializer { EntryViewModel(unlocked.ledger) } })
                EntryScreen(form, onDone = { nav.popBackStack() })
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

@Composable
private fun Placeholder(title: Int) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(stringResource(R.string.placeholder_title, stringResource(title)))
    }
}
