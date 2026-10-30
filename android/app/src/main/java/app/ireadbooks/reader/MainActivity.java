package app.ireadbooks.reader;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.util.Locale;

/**
 * The app draws to the very edges on every Android version and WebView, so the strip under the
 * status bar is the page's own colour. (Capacitor's own handling pads the window instead on
 * WebViews older than 140, and that strip showed the window behind: white.) The page keeps clear
 * of the bars with the --safe-area-inset-* CSS variables set here, which work on any WebView.
 */
public class MainActivity extends BridgeActivity {

    /** The bars' insets in px, keyboard taken into account. */
    private Insets bars = Insets.NONE;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null) return; // no WebView on this device
        EdgeToEdge.enable(this);

        View decor = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
            Insets sys = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            boolean keyboard = insets.isVisible(WindowInsetsCompat.Type.ime());
            // Room for the keyboard; everything else is the page's to draw.
            v.setPadding(0, 0, 0, keyboard ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0);
            bars = Insets.of(sys.left, sys.top, sys.right, keyboard ? 0 : sys.bottom);
            injectInsets();
            return insets;
        });

        // A new page (start, reload, a new version switched in) starts without them.
        bridge.addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageCommitVisible(WebView view, String url) {
                    injectInsets();
                    decor.requestApplyInsets();
                }
            }
        );
    }

    private void injectInsets() {
        WebView web = bridge.getWebView();
        if (web == null) return;
        float d = getResources().getDisplayMetrics().density;
        String js = String.format(
            Locale.US,
            "(function(s){s.setProperty('--safe-area-inset-top','%.1fpx');s.setProperty('--safe-area-inset-right','%.1fpx');" +
            "s.setProperty('--safe-area-inset-bottom','%.1fpx');s.setProperty('--safe-area-inset-left','%.1fpx')})(document.documentElement.style)",
            bars.top / d,
            bars.right / d,
            bars.bottom / d,
            bars.left / d
        );
        web.post(() -> web.evaluateJavascript(js, null));
    }
}
