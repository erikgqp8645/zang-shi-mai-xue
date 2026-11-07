// 几何探针的 **WKWebView** 跑手 —— iOS 小程序用的就是 WebKit，
// 而 Chromium 的 `border-box` 与它不一样：2026-11-07 的「日期行逐列错开」
// 就是只在真机（WebKit）上才暴露、Chromium 上量不出来的那一类。
//
// 用法：webkit-probe <page.html> [视口宽]
//   · 打开页面，等脚本跑完
//   · 取 id 为 probe-result 的 pre 元素内容，原样打到 stdout
//
// 退出码：0 成功 ｜ 2 用法错 ｜ 3 页面里没拿到结果
import Cocoa
import WebKit

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write("用法：webkit-probe <page.html> [宽度]\n".data(using: .utf8)!)
    exit(2)
}
let htmlPath = args[1]
let width = args.count >= 3 ? (Double(args[2]) ?? 375) : 375

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let cfg = WKWebViewConfiguration()
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: 1400), configuration: cfg)
let win = NSWindow(contentRect: web.frame, styleMask: [.borderless], backing: .buffered, defer: false)
win.contentView = web
win.orderFront(nil)

final class Nav: NSObject, WKNavigationDelegate {
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        // 等一小会儿：脚本是同步跑的，但字体与首帧可能晚一点点
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            let js = "(function(){var p=document.getElementById('probe-result');return p?p.textContent:''})()"
            w.evaluateJavaScript(js) { res, err in
                if let err = err {
                    FileHandle.standardError.write("JSERR: \(err)\n".data(using: .utf8)!)
                    exit(3)
                }
                let s = (res as? String) ?? ""
                if s.isEmpty {
                    FileHandle.standardError.write("页面里没找到 probe-result（脚本没跑起来？）\n".data(using: .utf8)!)
                    exit(3)
                }
                print(s)
                exit(0)
            }
        }
    }
}

let nav = Nav()
web.navigationDelegate = nav
let url = URL(fileURLWithPath: htmlPath)
web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
app.run()
