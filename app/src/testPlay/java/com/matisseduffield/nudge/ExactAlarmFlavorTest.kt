package com.matisseduffield.nudge

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExactAlarmFlavorTest {
    @Test fun thePlayBuildAsksForExactAlarms() = assertTrue(BuildConfig.ASK_EXACT_ALARM)

    @Test fun thePlayBuildHasNoSelfUpdater() = assertFalse(BuildConfig.SELF_UPDATER)
}
