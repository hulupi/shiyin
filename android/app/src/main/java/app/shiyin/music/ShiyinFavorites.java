package app.shiyin.music;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;

@CapacitorPlugin(name = "ShiyinFavorites")
public final class ShiyinFavorites extends Plugin {
    static final String KEY = "trackIds";
    private static final String STORAGE = "shiyin_favorites";

    static SharedPreferences store(Context context) {
        return context.getSharedPreferences(STORAGE, Context.MODE_PRIVATE);
    }

    static List<String> tracks(SharedPreferences storage) {
        try { return ids(new JSONArray(storage.getString(KEY, "[]"))); }
        catch (JSONException error) { return new ArrayList<>(); }
    }

    static void toggle(SharedPreferences storage, String id) {
        List<String> current = tracks(storage);
        if (!current.remove(id)) current.add(0, id);
        write(storage, current);
    }

    private static List<String> ids(JSONArray values) {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        for (int index = 0; index < values.length(); index++) {
            String id = values.optString(index);
            if (id.startsWith("online:")) result.add(id);
        }
        return new ArrayList<>(result);
    }

    private static void write(SharedPreferences storage, List<String> current) {
        storage.edit().putString(KEY, new JSONArray(current).toString()).apply();
    }

    private static JSObject snapshot(SharedPreferences storage) {
        JSObject state = new JSObject();
        state.put("ids", new JSArray(tracks(storage)));
        return state;
    }

    private final SharedPreferences.OnSharedPreferenceChangeListener changes = (storage, key) -> {
        if (KEY.equals(key)) notifyListeners("changed", snapshot(storage));
    };

    @Override public void load() {
        store(getContext()).registerOnSharedPreferenceChangeListener(changes);
    }

    @PluginMethod public void getFavorites(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            SharedPreferences storage = store(getContext());
            if (!storage.contains(KEY)) write(storage, ids(call.getArray("initial", new JSArray())));
            call.resolve(snapshot(storage));
        });
    }

    @PluginMethod public void updateFavorites(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            SharedPreferences storage = store(getContext());
            String id = call.getString("toggleId", "");
            if (id.startsWith("online:")) toggle(storage, id);
            else {
                List<String> current = tracks(storage);
                current.removeAll(ids(call.getArray("removeIds", new JSArray())));
                write(storage, current);
            }
            call.resolve(snapshot(storage));
        });
    }

    @Override protected void handleOnDestroy() {
        store(getContext()).unregisterOnSharedPreferenceChangeListener(changes);
        super.handleOnDestroy();
    }
}
