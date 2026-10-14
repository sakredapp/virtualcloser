// ── Mac App Store shell for Suite CXO and Pinnacle ────────────────────────
//
// Suite CXO is a server-rendered Next app, so (exactly like the iOS/Android
// Capacitor apps in native/) the Mac app is a window on the hosted app:
//   Suite CXO -> https://suitecxo.com/login
//   Pinnacle  -> https://pinnacle.suitecxo.com/dashboard
// The start URL, name, bundle id and icon live in tauri.<edition>.conf.json.
//
// What the Rust side adds:
//   1. A navigation guard: only suitecxo.com and its subdomains load in the
//      window (same rule as allowNavigation in native/capacitor.config.ts);
//      every other link opens in the default browser.
//   2. The window's user agent carries "SuiteCXOApp/1.0" (set in the edition
//      config), which lib/nativeApp.ts reads to close billing and purchase
//      pages inside the store app (App Store guideline 3.1.1).
//   3. A standard macOS menu, so Cmd-C / Cmd-V work in a WKWebView.
//   4. Window state persistence.
// No IPC is exposed to the hosted pages: there are no capabilities.

use tauri::menu::{AboutMetadata, Menu, PredefinedMenuItem, Submenu};
use tauri::{Url, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

pub const ROOT_DOMAIN: &str = "suitecxo.com";

/// Should `url` load INSIDE the app window?
pub fn is_internal(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "asset" | "blob" | "data" | "about" => true,
        "https" => match url.host_str() {
            Some(h) => {
                let h = h.to_ascii_lowercase();
                h == ROOT_DOMAIN || h.ends_with(&format!(".{ROOT_DOMAIN}"))
            }
            None => false,
        },
        _ => false,
    }
}

fn build_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    app_name: &str,
) -> tauri::Result<Menu<R>> {
    let app_menu = Submenu::with_items(
        app,
        app_name,
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(AboutMetadata::default()))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit_menu, &view_menu, &window_menu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let app_name = app.package_info().name.clone();
            let cfg = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or("tauri.conf.json declares no window labelled \"main\"")?;
            let handle = app.handle().clone();
            WebviewWindowBuilder::from_config(app, &cfg)?
                .on_navigation(move |url| {
                    if is_internal(url) {
                        return true;
                    }
                    let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                    false
                })
                .build()?;
            app.set_menu(build_menu(app.handle(), &app_name)?)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Suite CXO desktop shell");
}

#[cfg(test)]
mod tests {
    use super::is_internal;
    use tauri::Url;

    fn internal(s: &str) -> bool {
        is_internal(&Url::parse(s).expect("test url"))
    }

    #[test]
    fn suite_hosts_stay_in_the_window() {
        assert!(internal("https://suitecxo.com/login"));
        assert!(internal("https://www.suitecxo.com/login"));
        assert!(internal("https://pinnacle.suitecxo.com/dashboard"));
        assert!(internal("about:blank"));
    }

    #[test]
    fn everything_else_goes_to_the_browser() {
        assert!(!internal("http://suitecxo.com/login"));
        assert!(!internal("https://suitecxo.com.evil.example/"));
        assert!(!internal("https://evilsuitecxo.com/"));
        assert!(!internal("https://accounts.google.com/o/oauth2/v2/auth"));
        assert!(!internal("https://billing.stripe.com/p/session/x"));
        assert!(!internal("mailto:a@b.co"));
        assert!(!internal("tel:+15555550123"));
        assert!(!internal("file:///etc/passwd"));
    }
}
