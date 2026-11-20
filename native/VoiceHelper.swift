import Foundation
import Speech
import AVFoundation
import Darwin

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object), let text = String(data: data, encoding: .utf8) else { return }
    print(text)
    fflush(stdout)
}
let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
if CommandLine.arguments.contains("--probe") {
    emit(["supportsOnDeviceRecognition": recognizer?.supportsOnDeviceRecognition ?? false,
          "available": recognizer?.isAvailable ?? false,
          "authorization": SFSpeechRecognizer.authorizationStatus().rawValue,
          "microphoneAuthorization": AVCaptureDevice.authorizationStatus(for: .audio).rawValue])
    exit(0)
}
guard CommandLine.arguments.contains("--listen") else { exit(64) }

final class Listener {
    let engine = AVAudioEngine()
    let lock = NSLock()
    var request: SFSpeechAudioBufferRecognitionRequest?
    var task: SFSpeechRecognitionTask?
    // Short RAM-only bridge preserves words while the recognizer finalizes a segment.
    var pendingAudio: [AVAudioPCMBuffer] = []
    var tapped = false
    var timer: Timer?
    var latest = ""
    var lastWord = Date()
    var segmentStart = Date()
    var generation = 0
    var sequence = 0
    var active = false
    var ending = false
    var lastMeter = Date.distantPast
    var loudFrames = 0

    func fail(_ message: String) {
        emit(["type":"status", "state":"error", "message":message])
        cleanup()
        exit(1)
    }
    func cleanup() {
        timer?.invalidate()
        if active { engine.stop() }
        if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
        active = false
        lock.lock(); request?.endAudio(); request = nil; pendingAudio.removeAll(); lock.unlock()
        task?.cancel()
    }
    func segment() {
        generation += 1
        let current = generation
        latest = ""; lastWord = Date(); segmentStart = Date(); ending = false
        let next = SFSpeechAudioBufferRecognitionRequest()
        next.requiresOnDeviceRecognition = true
        next.shouldReportPartialResults = true
        next.taskHint = .dictation
        lock.lock()
        request = next
        for buffer in pendingAudio { next.append(buffer) }
        pendingAudio.removeAll()
        lock.unlock()
        task = recognizer?.recognitionTask(with: next) { result, error in
            DispatchQueue.main.async {
                guard self.active && current == self.generation else { return }
                if let result = result {
                    let text = result.bestTranscription.formattedString
                    if text != self.latest {
                        self.latest = text; self.lastWord = Date()
                        if !result.isFinal && !text.isEmpty {
                            emit(["type":"transcript", "id":"\(ProcessInfo.processInfo.processIdentifier)-\(self.sequence + 1)", "text":text, "final":false])
                        }
                    }
                    if !text.isEmpty { emit(["type":"activity"]) }
                    if result.isFinal { self.commit(); self.segment(); return }
                }
                if let error = error {
                    // Ending a silent segment may yield a no-speech error. Keep the explicit session alive.
                    if self.ending { self.commit(); self.segment() }
                    else { self.fail("On-device recognition failed: \(error.localizedDescription). Check installed English dictation assets and macOS permissions.") }
                }
            }
        }
    }
    func commit() {
        guard !latest.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        sequence += 1
        emit(["type":"transcript", "id":"\(ProcessInfo.processInfo.processIdentifier)-\(sequence)", "text":latest, "final":true])
        latest = ""
    }
    func begin() {
        guard recognizer?.supportsOnDeviceRecognition == true else { fail("On-device English recognition is not supported. No cloud fallback is enabled."); return }
        active = true
        segment()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { fail("No microphone input device is available."); return }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            self.lock.lock()
            if let request = self.request { request.append(buffer) }
            else if self.pendingAudio.count < 192,
                    let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength),
                    let source = buffer.floatChannelData, let destination = copy.floatChannelData {
                copy.frameLength = buffer.frameLength
                for channel in 0..<Int(buffer.format.channelCount) {
                    destination[channel].update(from: source[channel], count: Int(buffer.frameLength))
                }
                self.pendingAudio.append(copy)
            }
            self.lock.unlock()
            guard let values = buffer.floatChannelData?[0] else { return }
            let count = Int(buffer.frameLength)
            guard count > 0 else { return }
            var sum: Float = 0
            for i in 0..<count { sum += values[i] * values[i] }
            let rms = sqrt(sum / Float(count))
            DispatchQueue.main.async {
                guard self.active else { return }
                self.loudFrames = rms > 0.015 ? self.loudFrames + 1 : 0
                if self.loudFrames == 3 { emit(["type":"activity"]) }
                if Date().timeIntervalSince(self.lastMeter) > 0.1 {
                    self.lastMeter = Date()
                    emit(["type":"level", "level":min(1, Double(rms) * 8)])
                }
            }
        }
        tapped = true
        do { engine.prepare(); try engine.start() }
        catch { fail("Microphone could not start: \(error.localizedDescription)"); return }
        emit(["type":"status", "state":"listening", "message":"On-device English recognition. Audio is not saved. Activity detection is an estimate."])
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
            if !self.ending && ((!self.latest.isEmpty && Date().timeIntervalSince(self.lastWord) > 1.2) || Date().timeIntervalSince(self.segmentStart) > 12) {
                self.ending = true
                self.lock.lock(); self.request?.endAudio(); self.request = nil; self.lock.unlock()
                // Restart even if the framework never delivers its final callback.
                let current = self.generation
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                    if self.active && current == self.generation { self.generation += 1; self.task?.cancel(); self.commit(); self.segment() }
                }
            }
        }
    }
}
let listener = Listener()
signal(SIGTERM, SIG_IGN)
signal(SIGINT, SIG_IGN)
let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
termination.setEventHandler { listener.cleanup(); exit(0) }
termination.resume()
let interruption = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
interruption.setEventHandler { listener.cleanup(); exit(0) }
interruption.resume()
// Only --listen, reached by the explicit UI Start Microphone action, requests permissions.
SFSpeechRecognizer.requestAuthorization { status in
    DispatchQueue.main.async {
        guard status == .authorized else { listener.fail("Speech permission denied. Enable ParliBot Voice in System Settings > Privacy & Security > Speech Recognition, or use typed input."); return }
        AVCaptureDevice.requestAccess(for: .audio) { allowed in
            DispatchQueue.main.async {
                guard allowed else { listener.fail("Microphone permission denied. Enable microphone access in System Settings or use typed input."); return }
                listener.begin()
            }
        }
    }
}
RunLoop.main.run()
