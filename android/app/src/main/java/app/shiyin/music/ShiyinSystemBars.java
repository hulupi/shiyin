package app.shiyin.music;

import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.webkit.WebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ShiyinSystemBars")
public final class ShiyinSystemBars extends Plugin {
    @PluginMethod
    public void setBackground(PluginCall call) {
        String statusColor = call.getString("status", "");
        String navigationColor = call.getString("navigation", "");
        if (!statusColor.matches("#[0-9a-fA-F]{6}") || !navigationColor.matches("#[0-9a-fA-F]{6}")) {
            call.reject("Invalid system bar color");
            return;
        }
        int status = Color.parseColor(statusColor);
        int navigation = Color.parseColor(navigationColor);
        getBridge().executeOnMainThread(() -> {
            Window window = getActivity().getWindow();
            WebView webView = getBridge().getWebView();
            window.setBackgroundDrawable(systemBarBackground(status, navigation));
            if (webView.getParent() instanceof View container) {
                container.setBackground(systemBarBackground(status, navigation));
            }
            // Older Android versions may draw opaque system bars. Newer versions
            // show the colored window and WebView underneath the transparent bars.
            window.setStatusBarColor(status);
            window.setNavigationBarColor(navigation);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                window.setStatusBarContrastEnforced(false);
                window.setNavigationBarContrastEnforced(false);
            }
            call.resolve();
        });
    }

    private static GradientDrawable systemBarBackground(int status, int navigation) {
        return new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] {status, status, navigation, navigation});
    }
}
