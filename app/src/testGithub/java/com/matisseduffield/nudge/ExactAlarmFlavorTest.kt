package com.matisseduffield.nudge

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExactAlarmFlavorTest {
    @Test fun theGithubBuildNeverAsksForExactAlarms() = assertFalse(BuildConfig.ASK_EXACT_ALARM)

    @Test fun theGithubBuildKeepsItsSelfUpdater() = assertTrue(BuildConfig.SELF_UPDATER)
}
