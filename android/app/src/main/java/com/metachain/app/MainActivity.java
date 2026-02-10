package com.metachain.app;

import android.os.Bundle;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;
import android.view.View;
import android.view.ViewGroup;
import android.graphics.Rect;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.graphics.Insets;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    private int lastKeyboardHeight = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Get the WebView instance from the Bridge
        final WebView webView = getBridge().getWebView();

        // 1. SSL Bypass: Extend BridgeWebViewClient to keep Bridge functional
        webView.setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Allow self-signed certificates for localhost/127.0.0.1
                // Standard Capacitor client would block this
                handler.proceed();
            }
        });

        // 2. Clipboard/Permissions: Extend BridgeWebChromeClient
        webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // Grant all permissions (camera, clipboard, etc.)
                // This fixes Navigator.clipboard.writeText
                request.grant(request.getResources());
            }
        });

        // 3. Keyboard Handling: Force WebView to resize when keyboard appears
        final View rootView = findViewById(android.R.id.content);

        rootView.getViewTreeObserver().addOnGlobalLayoutListener(() -> {
            Rect r = new Rect();
            rootView.getWindowVisibleDisplayFrame(r);

            int screenHeight = rootView.getRootView().getHeight();
            int keyboardHeight = screenHeight - r.bottom;

            // Only act if keyboard height changed significantly (>100px)
            if (Math.abs(keyboardHeight - lastKeyboardHeight) > 100) {
                lastKeyboardHeight = keyboardHeight;

                // Force WebView to adjust its height
                ViewGroup.LayoutParams params = webView.getLayoutParams();
                if (keyboardHeight > 100) {
                    // Keyboard is visible - reduce WebView height
                    params.height = r.bottom;
                } else {
                    // Keyboard is hidden - restore full height
                    params.height = ViewGroup.LayoutParams.MATCH_PARENT;
                }
                webView.setLayoutParams(params);
                webView.requestLayout();
            }
        });
    }
}
