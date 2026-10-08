use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Open Nexus", true, None::<&str>)?;
    let status = Submenu::with_items(
        app,
        "Set status",
        true,
        &[
            &MenuItem::with_id(app, "status:join me", "Join Me", true, None::<&str>)?,
            &MenuItem::with_id(app, "status:active", "Online", true, None::<&str>)?,
            &MenuItem::with_id(app, "status:ask me", "Ask Me", true, None::<&str>)?,
            &MenuItem::with_id(app, "status:busy", "Do Not Disturb", true, None::<&str>)?,
        ],
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &status, &PredefinedMenuItem::separator(app)?, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Nexus")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            if id == "show" {
                show_main(app);
            } else if id == "quit" {
                app.exit(0);
            } else if let Some(status) = id.strip_prefix("status:") {
                let (app, status) = (app.clone(), status.to_string());
                tauri::async_runtime::spawn(async move {
                    let _ = crate::commands::set_status(&app, &status, None).await;
                });
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
