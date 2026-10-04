package in.gov.appolice.mto;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import in.gov.appolice.mto.location.DutyLocationPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin, live location (location/), registered before the bridge starts.
        registerPlugin(DutyLocationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
