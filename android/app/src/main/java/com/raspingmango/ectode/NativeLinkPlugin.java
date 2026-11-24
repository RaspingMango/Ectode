package com.raspingmango.ectode;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.ContactsContract;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@CapacitorPlugin(name = "NativeLink")
public class NativeLinkPlugin extends Plugin {

    private static final Set<String> BLOCKED_SCHEMES = new HashSet<>(Arrays.asList(
        "javascript", "data", "vbscript", "file", "content"
    ));

    private static final String BROWSER_PROBE_URL = "https://ectode-probe.invalid/";

    @PluginMethod
    public void inspectUrl(PluginCall call) {
        final Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }

        final String rawUrl = call.getString("url", "");
        final Uri uri = parseSafeUri(rawUrl);
        if (uri == null) {
            JSObject empty = new JSObject();
            empty.put("isHttpUrl", false);
            empty.put("hasSupportedApp", false);
            empty.put("apps", new JSArray());
            call.resolve(empty);
            return;
        }

        final String scheme = uri.getScheme() != null
            ? uri.getScheme().toLowerCase(Locale.ROOT)
            : "";
        final boolean isHttpUrl = "http".equals(scheme) || "https".equals(scheme);

        final PackageManager pm = context.getPackageManager();
        final String selfPackage = context.getPackageName();
        final Set<String> browserPackages = isHttpUrl
            ? findBrowserPackages(pm)
            : new HashSet<>();

        final Intent targetIntent = buildViewIntent(uri);
        final List<ResolveInfo> resolved = queryActivities(pm, targetIntent, PackageManager.MATCH_ALL);

        final Map<String, String> appLabels = new LinkedHashMap<>();
        for (ResolveInfo info : resolved) {
            if (info == null || info.activityInfo == null || !info.activityInfo.exported) {
                continue;
            }
            final String pkg = info.activityInfo.packageName;
            if (pkg == null || pkg.isEmpty() || pkg.equals(selfPackage) || "android".equals(pkg)) {
                continue;
            }
            if (isHttpUrl && browserPackages.contains(pkg)) {
                continue;
            }
            if (!appLabels.containsKey(pkg)) {
                CharSequence rawLabel = info.loadLabel(pm);
                String label = rawLabel != null ? rawLabel.toString().trim() : pkg;
                if (label.isEmpty()) {
                    label = pkg;
                }
                appLabels.put(pkg, label);
            }
        }

        JSArray appsArray = new JSArray();
        JSObject primaryApp = null;
        for (Map.Entry<String, String> entry : appLabels.entrySet()) {
            JSObject item = new JSObject();
            item.put("packageName", entry.getKey());
            item.put("label", entry.getValue());
            appsArray.put(item);
            if (primaryApp == null) {
                primaryApp = item;
            }
        }

        JSObject result = new JSObject();
        result.put("isHttpUrl", isHttpUrl);
        result.put("hasSupportedApp", !appLabels.isEmpty());
        if (primaryApp != null) {
            result.put("primaryApp", primaryApp);
        }
        result.put("apps", appsArray);
        call.resolve(result);
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        final Activity activity = getActivity();
        final Context context = getContext();
        if (activity == null || context == null) {
            call.reject("Activity not available");
            return;
        }

        final String rawUrl = call.getString("url", "");
        final Uri uri = parseSafeUri(rawUrl);
        if (uri == null) {
            call.reject("Invalid or unsupported URL");
            return;
        }

        final String mode = call.getString("mode", "system");
        final String requestedPackage = call.getString("packageName", null);
        final String chooserTitle = call.getString("chooserTitle", null);

        activity.runOnUiThread(() -> {
            try {
                boolean opened = false;
                if ("browser".equalsIgnoreCase(mode)) {
                    opened = openInBrowser(activity, context, uri, chooserTitle);
                } else if ("app".equalsIgnoreCase(mode)) {
                    opened = openInSupportedApp(activity, context, uri, requestedPackage, chooserTitle);
                } else {
                    opened = openViaSystem(activity, uri);
                }

                JSObject res = new JSObject();
                res.put("opened", opened);
                if (!opened) {
                    res.put("reason", "no_app");
                }
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Failed to open URL: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void addContact(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }

        final String name = call.getString("name", "");
        final String phone = call.getString("phone", "");
        final String email = call.getString("email", "");
        final String org = call.getString("org", "");

        activity.runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_INSERT);
                intent.setType(ContactsContract.Contacts.CONTENT_TYPE);
                if (name != null && !name.trim().isEmpty()) {
                    intent.putExtra(ContactsContract.Intents.Insert.NAME, name.trim());
                }
                if (phone != null && !phone.trim().isEmpty()) {
                    intent.putExtra(ContactsContract.Intents.Insert.PHONE, phone.trim());
                }
                if (email != null && !email.trim().isEmpty()) {
                    intent.putExtra(ContactsContract.Intents.Insert.EMAIL, email.trim());
                }
                if (org != null && !org.trim().isEmpty()) {
                    intent.putExtra(ContactsContract.Intents.Insert.COMPANY, org.trim());
                }
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                boolean opened;
                try {
                    activity.startActivity(intent);
                    opened = true;
                } catch (ActivityNotFoundException | SecurityException e) {
                    opened = false;
                }

                JSObject res = new JSObject();
                res.put("opened", opened);
                if (!opened) {
                    res.put("reason", "no_app");
                }
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Failed to open contacts: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void openWifiSettings(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }

        activity.runOnUiThread(() -> {
            boolean opened = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                Intent panelIntent = new Intent(Settings.Panel.ACTION_WIFI);
                panelIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    activity.startActivity(panelIntent);
                    opened = true;
                } catch (ActivityNotFoundException | SecurityException ignored) {
                    opened = false;
                }
            }
            if (!opened) {
                Intent settingsIntent = new Intent(Settings.ACTION_WIFI_SETTINGS);
                settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    activity.startActivity(settingsIntent);
                    opened = true;
                } catch (ActivityNotFoundException | SecurityException ignored) {
                    opened = false;
                }
            }

            JSObject res = new JSObject();
            res.put("opened", opened);
            call.resolve(res);
        });
    }

    private boolean openInSupportedApp(
        Activity activity,
        Context context,
        Uri uri,
        String requestedPackage,
        String chooserTitle
    ) {
        if (requestedPackage != null && !requestedPackage.trim().isEmpty()) {
            Intent explicit = buildViewIntent(uri);
            explicit.setPackage(requestedPackage.trim());
            explicit.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                activity.startActivity(explicit);
                return true;
            } catch (ActivityNotFoundException | SecurityException ignored) {
                // Fall through to general non-browser resolution
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Intent nonBrowser = buildViewIntent(uri);
            nonBrowser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REQUIRE_NON_BROWSER);
            try {
                activity.startActivity(nonBrowser);
                return true;
            } catch (ActivityNotFoundException | SecurityException ignored) {
                // Fall through to explicit package list / system chooser
            }
        }

        final PackageManager pm = context.getPackageManager();
        final Set<String> browserPackages = findBrowserPackages(pm);
        final String selfPackage = context.getPackageName();
        final List<String> nonBrowserPackages = new ArrayList<>();

        for (ResolveInfo info : queryActivities(pm, buildViewIntent(uri), PackageManager.MATCH_ALL)) {
            if (info == null || info.activityInfo == null || !info.activityInfo.exported) continue;
            String pkg = info.activityInfo.packageName;
            if (pkg == null || pkg.isEmpty() || pkg.equals(selfPackage) || "android".equals(pkg)) continue;
            if (browserPackages.contains(pkg)) continue;
            if (!nonBrowserPackages.contains(pkg)) {
                nonBrowserPackages.add(pkg);
            }
        }

        if (nonBrowserPackages.size() == 1) {
            Intent single = buildViewIntent(uri);
            single.setPackage(nonBrowserPackages.get(0));
            single.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                activity.startActivity(single);
                return true;
            } catch (ActivityNotFoundException | SecurityException ignored) {
                // Fall through to system handler
            }
        } else if (nonBrowserPackages.size() > 1) {
            if (launchChooserForPackages(activity, uri, nonBrowserPackages, chooserTitle)) {
                return true;
            }
        }

        return openViaSystem(activity, uri);
    }

    private boolean openInBrowser(
        Activity activity,
        Context context,
        Uri uri,
        String chooserTitle
    ) {
        final PackageManager pm = context.getPackageManager();
        final Set<String> browserPackages = findBrowserPackages(pm);
        final ResolveInfo defaultBrowser = resolveActivity(pm, buildViewIntent(Uri.parse(BROWSER_PROBE_URL)));

        if (defaultBrowser != null && defaultBrowser.activityInfo != null) {
            String defaultPkg = defaultBrowser.activityInfo.packageName;
            if (defaultPkg != null && browserPackages.contains(defaultPkg)) {
                Intent browserIntent = buildViewIntent(uri);
                browserIntent.setPackage(defaultPkg);
                browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    activity.startActivity(browserIntent);
                    return true;
                } catch (ActivityNotFoundException | SecurityException ignored) {
                    // Fall through to other installed browsers
                }
            }
        }

        if (!browserPackages.isEmpty()) {
            List<String> browsers = new ArrayList<>(browserPackages);
            if (browsers.size() == 1) {
                Intent single = buildViewIntent(uri);
                single.setPackage(browsers.get(0));
                single.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    activity.startActivity(single);
                    return true;
                } catch (ActivityNotFoundException | SecurityException ignored) {
                    // Fall through to system handler
                }
            } else if (launchChooserForPackages(activity, uri, browsers, chooserTitle)) {
                return true;
            }
        }

        return openViaSystem(activity, uri);
    }

    private boolean openViaSystem(Activity activity, Uri uri) {
        Intent intent = buildViewIntent(uri);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            activity.startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    private boolean launchChooserForPackages(
        Activity activity,
        Uri uri,
        List<String> packages,
        String chooserTitle
    ) {
        if (packages.isEmpty()) return false;

        List<Intent> intents = new ArrayList<>();
        for (String pkg : packages) {
            Intent target = buildViewIntent(uri);
            target.setPackage(pkg);
            target.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intents.add(target);
        }

        Intent base = intents.remove(0);
        Intent chooser = Intent.createChooser(
            base,
            chooserTitle != null && !chooserTitle.isEmpty() ? chooserTitle : null
        );
        if (!intents.isEmpty()) {
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, intents.toArray(new Intent[0]));
        }
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            activity.startActivity(chooser);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    private static Intent buildViewIntent(Uri uri) {
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        final String scheme = uri.getScheme() != null
            ? uri.getScheme().toLowerCase(Locale.ROOT)
            : "";
        if ("http".equals(scheme) || "https".equals(scheme)) {
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
        }
        return intent;
    }

    private static Set<String> findBrowserPackages(PackageManager pm) {
        Set<String> browsers = new HashSet<>();
        Intent probeIntent = buildViewIntent(Uri.parse(BROWSER_PROBE_URL));
        for (ResolveInfo info : queryActivities(pm, probeIntent, PackageManager.MATCH_ALL)) {
            if (info != null && info.activityInfo != null && info.activityInfo.packageName != null) {
                browsers.add(info.activityInfo.packageName);
            }
        }
        return browsers;
    }

    private static List<ResolveInfo> queryActivities(PackageManager pm, Intent intent, int flags) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(flags));
        }
        return queryActivitiesLegacy(pm, intent, flags);
    }

    @SuppressWarnings("deprecation")
    private static List<ResolveInfo> queryActivitiesLegacy(PackageManager pm, Intent intent, int flags) {
        return pm.queryIntentActivities(intent, flags);
    }

    private static ResolveInfo resolveActivity(PackageManager pm, Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return pm.resolveActivity(
                intent,
                PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY)
            );
        }
        return resolveActivityLegacy(pm, intent);
    }

    @SuppressWarnings("deprecation")
    private static ResolveInfo resolveActivityLegacy(PackageManager pm, Intent intent) {
        return pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);
    }

    private static Uri parseSafeUri(String rawUrl) {
        if (rawUrl == null) return null;
        String trimmed = rawUrl.trim();
        if (trimmed.isEmpty()) return null;

        Uri uri;
        try {
            uri = Uri.parse(trimmed);
        } catch (Exception e) {
            return null;
        }
        if (uri == null) return null;

        String scheme = uri.getScheme();
        if (scheme == null || scheme.trim().isEmpty()) return null;
        String lowerScheme = scheme.trim().toLowerCase(Locale.ROOT);
        if (BLOCKED_SCHEMES.contains(lowerScheme)) {
            return null;
        }
        if (("http".equals(lowerScheme) || "https".equals(lowerScheme))
            && (uri.getHost() == null || uri.getHost().trim().isEmpty())) {
            return null;
        }
        return uri;
    }
}
