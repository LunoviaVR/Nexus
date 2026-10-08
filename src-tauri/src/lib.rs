mod api;
mod avtrdb;
mod commands;
mod db;
mod error;
mod gamelog;
mod images;
mod location;
mod pipeline;
mod session;
mod settings;
mod state;
mod sync;
mod tray;
mod ugc;
mod vault;
mod vrc_config;
mod vrc_launch;
mod vrcx;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

use state::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_main(app)))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .register_asynchronous_uri_scheme_protocol("nximg", images::handle)
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            // Everything personal is encrypted at rest with a key from Windows Credential Manager.
            let (master, _) = vault::master_key()?;
            vault::init_images(&master);
            let db = db::Db::open(&dir.join("nexus.db"), &vault::database_key(&master))?;
            images::forget_plain_cache(app.handle());
            app.manage(AppState::new(db));
            tray::create(app.handle())?;
            gamelog::spawn(app.handle().clone());
            ugc::spawn(app.handle().clone());
            if !std::env::args().any(|a| a == "--minimized") {
                tray::show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<AppState>().settings().minimize_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth_login,
            commands::auth_verify,
            commands::auth_restore,
            commands::auth_logout,
            commands::accounts_list,
            commands::account_remove,
            commands::me_get,
            commands::friends_list,
            commands::friends_refresh,
            commands::user_get,
            commands::profile_get,
            commands::profile_update,
            commands::me_update,
            commands::badge_set,
            commands::group_represent,
            commands::icons_list,
            commands::icon_upload,
            commands::image_upload,
            commands::files_list,
            commands::prints_list,
            commands::inventory_all,
            commands::inventory_unequip,
            commands::inventory_delete,
            commands::avatar_lists,
            commands::profile_refresh,
            commands::entity_refresh,
            commands::user_groups,
            commands::user_mutuals,
            commands::group_get,
            commands::group_instances,
            commands::group_members,
            commands::groups_search,
            commands::group_join,
            commands::group_leave,
            commands::group_cancel_request,
            commands::my_group_instances,
            commands::my_group_instances_refresh,
            commands::group_members_search,
            commands::group_posts,
            commands::user_worlds,
            commands::user_note_set,
            commands::balance_get,
            commands::world_get,
            commands::avatar_get,
            commands::instance_get,
            commands::users_search,
            commands::worlds_search,
            commands::worlds_list,
            commands::avatars_list,
            commands::avatar_select,
            commands::avatar_discover,
            commands::seen_avatars,
            commands::avatar_favorites,
            commands::favorite_groups,
            commands::favorites_of,
            commands::favorite_add,
            commands::favorite_remove,
            commands::avatar_favorite_add,
            commands::avatar_favorite_remove,
            commands::favorite_friend_toggle,
            commands::watch_list,
            commands::watch_set,
            commands::invite_user,
            commands::request_invite,
            commands::boop_user,
            commands::invite_self,
            commands::launch_location,
            commands::open_external,
            commands::status_set,
            commands::friend_request,
            commands::notifications_list,
            commands::notification_accept,
            commands::notification_hide,
            commands::notification_v2_delete,
            commands::feed_query,
            commands::gamelog_sessions,
            commands::gamelog_events,
            commands::gamelog_current,
            commands::user_history,
            commands::insights_get,
            commands::memo_get,
            commands::memo_set,
            commands::settings_get,
            commands::settings_set,
            commands::default_log_dir,
            commands::vrchat_install_get,
            commands::vrchat_dir_set,
            commands::vrchat_links_repair,
            commands::photo_dir_get,
            commands::photo_dir_set,
            commands::ugc_dir_get,
            commands::open_folder,
            commands::image_download,
            commands::cache_clear,
            commands::export_csv,
            commands::reveal_path,
            commands::db_export_decrypted,
            commands::vrcx_detect,
            commands::vrcx_import,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nexus");
}
