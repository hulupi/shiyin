package app.shiyin.music;

import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ShiyinSystemBars")
public final class ShiyinSystemBars extends Plugin {
    private int status;
    private int navigation;
    private boolean darkIcons;
    private boolean hasAppearance;

    @PluginMethod
    public void setAppearance(PluginCall call) {
        String statusColor = call.getString("status", "");
        String navigationColor = call.getString("navigation", "");
        if (!statusColor.matches("#[0-9a-fA-F]{6}") || !navigationColor.matches("#[0-9a-fA-F]{6}")) {
            call.reject("Invalid system bar color");
            return;
        }
        getBridge().executeOnMainThread(() -> {
            status = Color.parseColor(statusColor);
            navigation = Color.parseColor(navigationColor);
            darkIcons = Boolean.TRUE.equals(call.getBoolean("darkIcons", false));
            hasAppearance = true;
            applyAppearance();
            call.resolve();
        });
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration configuration) {
        super.handleOnConfigurationChanged(configuration);
        // Apply after Capacitor's own configuration callbacks.
        getBridge().getWebView().post(() -> {
            if (hasAppearance) applyAppearance();
        });
    }

    private void applyAppearance() {
        Window window = getActivity().getWindow();
        WebView webView = getBridge().getWebView();
        window.setBackgroundDrawable(systemBarBackground());
        if (webView.getParent() instanceof View container) {
            container.setBackground(systemBarBackground());
        }
        window.setStatusBarColor(status);
        window.setNavigationBarColor(navigation);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(darkIcons);
        controller.setAppearanceLightNavigationBars(darkIcons);
    }

    private GradientDrawable systemBarBackground() {
        return new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] {status, status, navigation, navigation});
    }
}
