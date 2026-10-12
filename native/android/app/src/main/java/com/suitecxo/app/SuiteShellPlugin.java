package com.suitecxo.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The app's own plugin. Mirrors ios/App/App/SuiteShellPlugin.swift.
 *
 * The lock lives here, not in the web page, so it covers every page the app
 * shows (the local sign-in screen and the hosted site alike) and cannot be
 * skipped by a page that fails to load.
 */
@CapacitorPlugin(name = "SuiteShell")
public class SuiteShellPlugin extends Plugin {

    private static final String PREFS = "cxo.shell";
    private static final String KEY_LOCK = "cxo.lock.enabled";
    /** Leaving the app for less than this does not ask again. */
    private static final long GRACE_MS = 60_000L;
    private static final int AUTHENTICATORS =
        BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    private View cover;
    private long stoppedAt = -1L;
    private boolean prompting = false;
    private boolean unlockedThisSession = false;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private boolean lockEnabled() {
        return prefs().getBoolean(KEY_LOCK, false);
    }

    private boolean canAuthenticate() {
        return BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS;
    }

    private String kind() {
        if (!canAuthenticate()) return "none";
        int bio = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK);
        return bio == BiometricManager.BIOMETRIC_SUCCESS ? "fingerprint" : "passcode";
    }

    @Override
    public void load() {
        if (lockEnabled() && canAuthenticate()) {
            getActivity().runOnUiThread(() -> {
                showCover();
                prompt(null);
            });
        }
    }

    @Override
    protected void handleOnStop() {
        stoppedAt = SystemClock.elapsedRealtime();
        // Cover before the app is snapshotted for the recent-apps screen.
        if (lockEnabled() && canAuthenticate() && !prompting) showCover();
    }

    @Override
    protected void handleOnStart() {
        if (!lockEnabled() || !canAuthenticate()) {
            hideCover();
            return;
        }
        if (prompting) return;
        boolean recent = unlockedThisSession && stoppedAt > 0 && SystemClock.elapsedRealtime() - stoppedAt < GRACE_MS;
        if (recent) {
            hideCover();
        } else if (cover != null) {
            prompt(null);
        }
    }

    @PluginMethod
    public void lockStatus(PluginCall call) {
        JSObject out = new JSObject();
        out.put("available", canAuthenticate());
        out.put("kind", kind());
        out.put("enabled", lockEnabled() && canAuthenticate());
        call.resolve(out);
    }

    @PluginMethod
    public void setLockEnabled(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (!canAuthenticate()) {
            call.reject("This phone has no screen lock set up.");
            return;
        }
        // Turning it on or off both need the person to prove it is them.
        getActivity().runOnUiThread(() ->
            prompt(ok -> {
                if (!ok) {
                    call.reject("Unlock was cancelled.");
                    return;
                }
                prefs().edit().putBoolean(KEY_LOCK, enabled).apply();
                JSObject out = new JSObject();
                out.put("enabled", enabled);
                call.resolve(out);
            })
        );
    }

    /**
     * Push registration on Android crashes the app when the build has no
     * google-services.json. The file is added by the owner after the Firebase
     * app exists, so the page asks here first.
     */
    @PluginMethod
    public void pushReady(PluginCall call) {
        Context ctx = getContext();
        int id = ctx.getResources().getIdentifier("google_app_id", "string", ctx.getPackageName());
        JSObject out = new JSObject();
        out.put("ready", id != 0);
        call.resolve(out);
    }

    @PluginMethod
    public void setChrome(PluginCall call) {
        final String color = call.getString("color", "#0E0F11");
        final boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", true));
        getActivity().runOnUiThread(() -> {
            try {
                int parsed = Color.parseColor(color);
                Window window = getActivity().getWindow();
                window.getDecorView().setBackgroundColor(parsed);
                if (bridge != null && bridge.getWebView() != null) bridge.getWebView().setBackgroundColor(parsed);
                WindowInsetsControllerCompat insets = WindowCompat.getInsetsController(window, window.getDecorView());
                insets.setAppearanceLightStatusBars(!dark);
                insets.setAppearanceLightNavigationBars(!dark);
            } catch (IllegalArgumentException ignored) {
                // Not a colour we can parse: leave the bars as they are.
            }
            call.resolve();
        });
    }

    private interface Done {
        void result(boolean ok);
    }

    private void prompt(final Done done) {
        if (prompting) {
            if (done != null) done.result(false);
            return;
        }
        AppCompatActivity activity = getActivity();
        prompting = true;
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock Suite CXO")
            .setAllowedAuthenticators(AUTHENTICATORS)
            .build();
        BiometricPrompt biometricPrompt = new BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    prompting = false;
                    unlockedThisSession = true;
                    stoppedAt = -1L;
                    hideCover();
                    if (done != null) done.result(true);
                }

                @Override
                public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                    // Cancelled or locked out. The cover (if any) stays, with its Unlock button.
                    prompting = false;
                    if (done != null) done.result(false);
                }
            }
        );
        try {
            biometricPrompt.authenticate(info);
        } catch (Exception e) {
            prompting = false;
            if (done != null) done.result(false);
        }
    }

    private int dp(int value) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getContext().getResources().getDisplayMetrics());
    }

    private void showCover() {
        if (cover != null) return;
        AppCompatActivity activity = getActivity();
        LinearLayout box = new LinearLayout(activity);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.parseColor("#0E0F11"));
        box.setClickable(true);
        box.setFocusable(true);

        TextView title = new TextView(activity);
        title.setText("Suite CXO is locked");
        title.setTextColor(Color.parseColor("#F2F3F5"));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setGravity(Gravity.CENTER);
        box.addView(title);

        Button unlock = new Button(activity);
        unlock.setText("Unlock");
        unlock.setAllCaps(false);
        unlock.setTextColor(Color.parseColor("#0F1012"));
        unlock.setBackgroundColor(Color.parseColor("#C9CDD2"));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(200), dp(52));
        lp.topMargin = dp(24);
        unlock.setLayoutParams(lp);
        unlock.setOnClickListener(v -> prompt(null));
        box.addView(unlock);

        activity.addContentView(
            box,
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        cover = box;
    }

    private void hideCover() {
        if (cover == null) return;
        ViewGroup parent = (ViewGroup) cover.getParent();
        if (parent != null) parent.removeView(cover);
        cover = null;
    }
}
