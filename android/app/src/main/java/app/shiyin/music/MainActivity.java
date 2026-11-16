package app.shiyin.music;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShiyinNetwork.class);
        registerPlugin(ShiyinPlayback.class);
        registerPlugin(ShiyinSystemBars.class);
        super.onCreate(savedInstanceState);
    }
}
