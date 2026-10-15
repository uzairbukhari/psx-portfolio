package app.sipwise

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.List
import androidx.compose.material.icons.outlined.PieChart
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import kotlinx.serialization.Serializable

/** Type-safe top-level routes. The four destinations match the Expo app's tabs. */
@Serializable object Today

@Serializable object Portfolio

@Serializable object Plan

@Serializable object Activity

private data class TopLevel(val route: Any, val label: Int, val icon: ImageVector)

private val topLevel =
    listOf(
        TopLevel(Today, R.string.nav_today, Icons.Outlined.Home),
        TopLevel(Portfolio, R.string.nav_portfolio, Icons.Outlined.PieChart),
        TopLevel(Plan, R.string.nav_plan, Icons.Outlined.Timeline),
        TopLevel(Activity, R.string.nav_activity, Icons.Outlined.List),
    )

@Composable
fun SipwiseRoot() {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    Scaffold(
        bottomBar = {
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
        },
    ) { padding ->
        NavHost(nav, startDestination = Today, modifier = Modifier.padding(padding)) {
            composable<Today> { Placeholder(R.string.nav_today) }
            composable<Portfolio> { Placeholder(R.string.nav_portfolio) }
            composable<Plan> { Placeholder(R.string.nav_plan) }
            composable<Activity> { Placeholder(R.string.nav_activity) }
        }
    }
}

@Composable
private fun Placeholder(title: Int) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(stringResource(R.string.placeholder_title, stringResource(title)))
    }
}
