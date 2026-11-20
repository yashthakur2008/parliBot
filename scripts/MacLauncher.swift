import AppKit
import Foundation

let script = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/app/scripts/mac-launch.sh")
let task = Process()
task.executableURL = URL(fileURLWithPath: "/bin/bash")
task.arguments = [script.path]
do {
    try task.run()
    task.waitUntilExit()
    exit(task.terminationStatus)
} catch {
    let alert = NSAlert()
    alert.messageText = "ParliBot could not start"
    alert.informativeText = "The application bundle may be incomplete. Extract the downloaded ZIP again. \(error.localizedDescription)"
    alert.alertStyle = .critical
    alert.runModal()
    exit(1)
}
