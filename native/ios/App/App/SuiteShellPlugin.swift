import UIKit
import LocalAuthentication
import Capacitor

/// The app's own plugin. JS name: `SuiteShell` (native/src/native.ts).
@objc(SuiteShellPlugin)
public class SuiteShellPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SuiteShellPlugin"
    public let jsName = "SuiteShell"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "lockStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLockEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushReady", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setChrome", returnType: CAPPluginReturnPromise)
    ]

    @objc func lockStatus(_ call: CAPPluginCall) {
        let kind = AppLock.kind()
        call.resolve(["available": kind != "none", "kind": kind, "enabled": AppLock.shared.enabled])
    }

    @objc func setLockEnabled(_ call: CAPPluginCall) {
        let want = call.getBool("enabled") ?? false
        // Turning the lock on OR off needs the person to pass the prompt first.
        AppLock.authenticate(reason: want ? "Turn on the lock for Suite CXO" : "Turn off the lock for Suite CXO") { ok in
            if ok { AppLock.shared.enabled = want }
            call.resolve(["enabled": AppLock.shared.enabled])
        }
    }

    @objc func pushReady(_ call: CAPPluginCall) {
        // iOS registers with APNs directly; nothing extra has to be in the build.
        call.resolve(["ready": true])
    }

    @objc func setChrome(_ call: CAPPluginCall) {
        let dark = call.getBool("dark") ?? true
        let color = SuiteShellPlugin.color(from: call.getString("color") ?? "") ?? (dark ? UIColor(red: 0.055, green: 0.059, blue: 0.067, alpha: 1) : UIColor(red: 0.96, green: 0.965, blue: 0.97, alpha: 1))
        DispatchQueue.main.async {
            if let vc = self.bridge?.viewController as? SuiteViewController {
                vc.chromeDark = dark
                vc.view.backgroundColor = color
            }
            self.bridge?.webView?.backgroundColor = color
            self.bridge?.webView?.scrollView.backgroundColor = color
            call.resolve()
        }
    }

    /// "rgb(14, 15, 17)", "rgba(14,15,17,1)" or "#0E0F11" → UIColor.
    static func color(from css: String) -> UIColor? {
        let s = css.trimmingCharacters(in: .whitespaces).lowercased()
        if s.hasPrefix("#"), s.count == 7, let v = UInt32(s.dropFirst(), radix: 16) {
            return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
        }
        guard s.hasPrefix("rgb"), let open = s.firstIndex(of: "("), let close = s.firstIndex(of: ")") else { return nil }
        let parts = s[s.index(after: open)..<close].split(whereSeparator: { $0 == "," || $0 == " " || $0 == "/" }).compactMap { Double($0) }
        guard parts.count >= 3 else { return nil }
        // A fully transparent body has no ground of its own; keep the default.
        if parts.count >= 4, parts[3] == 0 { return nil }
        return UIColor(red: CGFloat(parts[0]) / 255, green: CGFloat(parts[1]) / 255, blue: CGFloat(parts[2]) / 255, alpha: 1)
    }
}

/// The lock. When it is on, a black cover sits over the whole app at launch and
/// after more than a minute in the background, and comes off only when Face ID,
/// Touch ID or the phone passcode passes. It is native on purpose: it works the
/// same on the local shell and on any hosted page, and the app switcher never
/// shows what was on screen.
final class AppLock {
    static let shared = AppLock()

    private let key = "cxo.lock.enabled"
    private let grace: TimeInterval = 60
    private var cover: UIWindow?
    private var leftAt: Date?
    private var needsAuth = false
    private var autoPrompt = true
    private var prompting = false
    private var started = false

    var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: key) }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    static func kind() -> String {
        let ctx = LAContext()
        var err: NSError?
        if ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) {
            return ctx.biometryType == .touchID ? "touch" : "face"
        }
        return ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) ? "passcode" : "none"
    }

    static func authenticate(reason: String, done: @escaping (Bool) -> Void) {
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else {
            DispatchQueue.main.async { done(false) }
            return
        }
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, _ in
            DispatchQueue.main.async { done(ok) }
        }
    }

    func start() {
        guard !started else { return }
        started = true
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        if enabled {
            needsAuth = true
            // The window scene is not on screen yet during launch; cover on the next turn.
            DispatchQueue.main.async { self.showCover() }
        }
    }

    @objc private func didEnterBackground() {
        guard enabled else { return }
        leftAt = Date()
        autoPrompt = true
        showCover()
    }

    @objc private func willEnterForeground() {
        guard cover != nil, !needsAuth else { return }
        if let left = leftAt, Date().timeIntervalSince(left) < grace {
            hideCover()
        } else {
            needsAuth = true
        }
    }

    @objc private func didBecomeActive() {
        // The Face ID sheet itself makes the app inactive then active again, so
        // only the first activation prompts by itself; after a miss the person taps Unlock.
        if needsAuth, autoPrompt { prompt() }
    }

    @objc private func prompt() {
        guard needsAuth, !prompting else { return }
        prompting = true
        autoPrompt = false
        AppLock.authenticate(reason: "Unlock Suite CXO") { ok in
            self.prompting = false
            if ok {
                self.needsAuth = false
                self.hideCover()
            }
        }
    }

    private func showCover() {
        guard cover == nil,
              let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
        let window = UIWindow(windowScene: scene)
        window.windowLevel = .alert + 1
        let vc = UIViewController()
        vc.view.backgroundColor = UIColor(red: 0.055, green: 0.059, blue: 0.067, alpha: 1)

        let title = UILabel()
        title.text = "Suite CXO is locked"
        title.textColor = UIColor(red: 0.95, green: 0.953, blue: 0.96, alpha: 1)
        title.font = UIFont(name: "Georgia", size: 24) ?? .systemFont(ofSize: 24, weight: .medium)
        title.textAlignment = .center

        var config = UIButton.Configuration.filled()
        config.title = "Unlock"
        config.baseBackgroundColor = UIColor(red: 0.79, green: 0.80, blue: 0.82, alpha: 1)
        config.baseForegroundColor = UIColor(red: 0.06, green: 0.063, blue: 0.07, alpha: 1)
        config.cornerStyle = .large
        config.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 44, bottom: 14, trailing: 44)
        let button = UIButton(configuration: config)
        button.addTarget(self, action: #selector(prompt), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [title, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 24
        stack.translatesAutoresizingMaskIntoConstraints = false
        vc.view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: vc.view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: vc.view.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: vc.view.leadingAnchor, constant: 24)
        ])

        window.rootViewController = vc
        window.isHidden = false
        cover = window
    }

    private func hideCover() {
        cover?.isHidden = true
        cover = nil
    }
}
