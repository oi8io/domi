//! domi 桌面端 —— PRD-M5-005 · docs/adr/021
//!
//! 只做两件事：打开窗口（内容是 apps/web 的构建产物），以及启动时检查更新。
//! 没有任何业务代码（AC-3）：会话、编排、记忆全在 domid 里，窗口里的页面经 WebSocket 连过去。

use tauri_plugin_updater::UpdaterExt;

/// 启动时查一次更新：有新版本就下载、安装、重启（AC-2）。
/// 失败只打日志——更新服务器不可达不该让应用打不开。
async fn check_update(app: tauri::AppHandle) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            eprintln!("domi: 更新检查没有配置好：{e}");
            return;
        }
    };
    match updater.check().await {
        Ok(Some(update)) => {
            eprintln!("domi: 发现新版本 {}，开始下载", update.version);
            if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
                eprintln!("domi: 更新安装失败：{e}");
                return;
            }
            app.restart();
        }
        Ok(None) => {}
        Err(e) => eprintln!("domi: 检查更新失败：{e}"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(check_update(handle));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("domi 桌面端启动失败");
}
