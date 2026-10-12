import UIKit
import WebKit
import Capacitor

/// The app's one screen: Capacitor's web view plus the pieces Suite CXO adds.
///
/// - registers the app's own plugin (SuiteShellPlugin: lock, chrome colour, push check)
/// - adds `public/native-inject.js` to every page, so the hosted Suite CXO pages
///   get push, share, haptics and deep-link handling without the website shipping any of it
/// - starts the lock, which covers the app until Face ID / Touch ID / passcode passes
class SuiteViewController: CAPBridgeViewController {

    /// Set by the page through SuiteShell.setChrome: true when the page ground is dark.
    var chromeDark = true {
        didSet { setNeedsStatusBarAppearanceUpdate() }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return chromeDark ? .lightContent : .darkContent
    }

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SuiteShellPlugin())

        if let url = Bundle.main.url(forResource: "native-inject", withExtension: "js", subdirectory: "public"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            // The script itself checks the host and does nothing outside suitecxo.com.
            let script = WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
            webView?.configuration.userContentController.addUserScript(script)
        }

        AppLock.shared.start()
    }
}
