package app.shiyin.music;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShiyinNetwork.class);
        registerPlugin(ShiyinPlayback.class);
        registerPlugin(ShiyinFavorites.class);
        registerPlugin(ShiyinSystemBars.class);
        super.onCreate(savedInstanceState);
        getWindow().setBackgroundDrawableResource(R.color.shiyin_launch_background);
        if (bridge != null && Build.VERSION.SDK_INT < 35) {
            // Use the system's content bounds on Android versions that still
            // support fitting the Activity between its native bars.
            View decor = getWindow().getDecorView();
            ViewCompat.setOnApplyWindowInsetsListener(decor, null);
            decor.setPadding(0, 0, 0, 0);
            WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
            ViewCompat.requestApplyInsets(decor);
        }
    }
}
