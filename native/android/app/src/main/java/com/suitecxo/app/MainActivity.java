package com.suitecxo.app;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * The one screen. Besides hosting the web view it does two things the stock
 * BridgeActivity does not:
 *
 *  1. registers the app's own plugin (SuiteShell: lock, push readiness, bar colours);
 *  2. runs native-inject.js on every page that finishes loading, so the hosted
 *     site at <company>.suitecxo.com gets share, haptics, push and deep links
 *     without the website shipping any app code. The script itself refuses to
 *     run on a host that is not suitecxo.com.
 */
public class MainActivity extends BridgeActivity {

    private String injectSource;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SuiteShellPlugin.class);
        super.onCreate(savedInstanceState);

        injectSource = readAsset("public/native-inject.js");
        if (bridge != null && injectSource != null) {
            bridge.addWebViewListener(
                new WebViewListener() {
                    @Override
                    public void onPageLoaded(WebView webView) {
                        String url = webView.getUrl();
                        if (url == null || !url.startsWith("https://")) return;
                        webView.evaluateJavascript(injectSource, null);
                    }
                }
            );
        }
    }

    private String readAsset(String path) {
        try (InputStream in = getAssets().open(path); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }
}
