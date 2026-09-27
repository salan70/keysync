// R-009 Spike: OS 層（Karabiner の出力の後）のキーイベントを CGEventTap で listen-only に記録できるか。
//
// 使い方: swift spikes/r-009-key-observe/event-tap.swift [秒数]
// イベントを書き換えず、keyDown / keyUp / flagsChanged を 1 行 1 JSON で標準出力へ出す。

import CoreGraphics
import Foundation

let seconds = Double(CommandLine.arguments.dropFirst().first ?? "") ?? 15

func emit(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
    let line = String(data: data, encoding: .utf8)
  else { return }
  print(line)
  fflush(stdout)
}

let kinds: [CGEventType: String] = [.keyDown: "down", .keyUp: "up", .flagsChanged: "flags"]
let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)
  | (1 << CGEventType.flagsChanged.rawValue)

let callback: CGEventTapCallBack = { _, type, event, _ in
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    emit(["type": "tap-disabled", "reason": type.rawValue])
    return Unmanaged.passUnretained(event)
  }
  var length = 0
  var chars = [UniChar](repeating: 0, count: 4)
  event.keyboardGetUnicodeString(maxStringLength: 4, actualStringLength: &length, unicodeString: &chars)
  emit([
    "type": "event",
    "kind": kinds[type] ?? "\(type.rawValue)",
    "keycode": event.getIntegerValueField(.keyboardEventKeycode),
    "flags": event.flags.rawValue,
    "chars": String(utf16CodeUnits: chars, count: length),
    "repeat": event.getIntegerValueField(.keyboardEventAutorepeat) != 0,
    "keyboardType": event.getIntegerValueField(.keyboardEventKeyboardType),
    "sourcePid": event.getIntegerValueField(.eventSourceUnixProcessID),
    "sourceStateId": event.getIntegerValueField(.eventSourceStateID),
    "ns": event.timestamp,
  ])
  return Unmanaged.passUnretained(event)
}

guard
  let tap = CGEvent.tapCreate(
    tap: .cghidEventTap, place: .headInsertEventTap, options: .listenOnly,
    eventsOfInterest: CGEventMask(mask), callback: callback, userInfo: nil)
else {
  emit(["type": "open", "ok": false, "hint": "入力監視の許可が無い可能性"])
  exit(1)
}
let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
emit(["type": "open", "ok": true, "seconds": seconds])

CFRunLoopRunInMode(CFRunLoopMode.defaultMode, seconds, false)
emit(["type": "end"])
