package app.shiyin.music;

import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
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
    private Integer drawerColor;
    private float drawerWidth;
    private boolean darkIcons;
    private boolean hasAppearance;
    private final BarBackground windowBackground = new BarBackground();
    private final BarBackground containerBackground = new BarBackground();

    @PluginMethod
    public void setAppearance(PluginCall call) {
        String statusColor = call.getString("status", "");
        String navigationColor = call.getString("navigation", "");
        if (!statusColor.matches("#[0-9a-fA-F]{6}") || !navigationColor.matches("#[0-9a-fA-F]{6}")) {
            call.reject("Invalid system bar color");
            return;
        }
        String drawer = call.getString("drawerColor", "");
        float width = call.getFloat("drawerWidth", 0f);
        getBridge().executeOnMainThread(() -> {
            drawerWidth = width * getContext().getResources().getDisplayMetrics().density;
            drawerColor = drawer != null && drawer.matches("#[0-9a-fA-F]{6}")
                ? Color.parseColor(drawer) : null;
            status = Color.parseColor(statusColor);
            navigation = Color.parseColor(navigationColor);
            boolean newDarkIcons = Boolean.TRUE.equals(call.getBoolean("darkIcons", false));
            if (!hasAppearance || darkIcons != newDarkIcons) {
                darkIcons = newDarkIcons;
                hasAppearance = true;
                applyAppearance();
            }
            windowBackground.update();
            containerBackground.update();
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
        window.setBackgroundDrawable(windowBackground);
        if (webView.getParent() instanceof View container) {
            container.setBackground(containerBackground);
        }
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(darkIcons);
        controller.setAppearanceLightNavigationBars(darkIcons);
    }

    private final class BarBackground extends GradientDrawable {
        private final Paint drawerPaint = new Paint();

        BarBackground() {
            super(Orientation.TOP_BOTTOM, new int[] {Color.BLACK, Color.BLACK});
        }

        void update() {
            setColors(new int[] {status, status, navigation, navigation});
            invalidateSelf();
        }

        @Override
        public void draw(Canvas canvas) {
            super.draw(canvas);
            if (drawerColor == null || drawerWidth <= 0) return;
            Rect bounds = getBounds();
            drawerPaint.setColor(drawerColor);
            float width = Math.min(drawerWidth, bounds.width());
            canvas.drawRect(bounds.left, bounds.top, bounds.left + width, bounds.bottom, drawerPaint);
        }
    }
}
