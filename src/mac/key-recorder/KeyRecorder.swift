// KeySync の打鍵レコーダー（ADR 0046）。`src/mac/key-recorder.ts` がビルドして起動する。
//
// 2 つの層を同時に記録し、1 行 1 JSON で標準出力へ出す。どちらも Karabiner が処理した後の入力で、
// 何も書き換えない（IOHID は seize せず、CGEventTap は listen-only）。
//
// - hid: Karabiner の仮想キーボードなど、seize されていないキーボードの Keyboard/Keypad page の値
// - os: CGEventTap（cghidEventTap）が受けた keyDown / keyUp / flagsChanged
//
// 時刻は起動からの ns を記録開始時点（originNs）からの相対値にして出す。CGEvent.timestamp も
// IOHIDValue の時刻も mach の tick なので、mach_timebase_info で ns へ換算する（R-009）。
//
// 使い方: key-recorder <秒数>。SIGINT / SIGTERM でも記録を閉じて終わる。

import CoreGraphics
import Foundation
import IOKit.hid

let seconds = Double(CommandLine.arguments.dropFirst().first ?? "") ?? 30

var timebase = mach_timebase_info_data_t()
mach_timebase_info(&timebase)
func nanoseconds(_ ticks: UInt64) -> UInt64 {
  ticks / UInt64(timebase.denom) * UInt64(timebase.numer)
    + ticks % UInt64(timebase.denom) * UInt64(timebase.numer) / UInt64(timebase.denom)
}
let origin = nanoseconds(mach_absolute_time())
func relative(_ ticks: UInt64) -> Int64 { Int64(bitPattern: nanoseconds(ticks) &- origin) }

func emit(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
    let line = String(data: data, encoding: .utf8)
  else { return }
  print(line)
  fflush(stdout)
}

func property(_ device: IOHIDDevice, _ key: String) -> String {
  guard let value = IOHIDDeviceGetProperty(device, key as CFString) else { return "" }
  return "\(value)"
}

// ---------- hid ----------

let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
IOHIDManagerSetDeviceMatching(
  manager,
  [kIOHIDDeviceUsagePageKey: kHIDPage_GenericDesktop, kIOHIDDeviceUsageKey: kHIDUsage_GD_Keyboard]
    as CFDictionary)
IOHIDManagerRegisterDeviceMatchingCallback(
  manager,
  { _, _, _, device in
    let opened = IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeNone))
    emit([
      "type": "device",
      "product": property(device, kIOHIDProductKey),
      "builtIn": property(device, "Built-In") == "1",
      "opened": opened == kIOReturnSuccess,
      "exclusive": opened == kIOReturnExclusiveAccess,
    ])
  }, nil)
IOHIDManagerRegisterInputValueCallback(
  manager,
  { _, _, _, value in
    let element = IOHIDValueGetElement(value)
    let usage = IOHIDElementGetUsage(element)
    guard IOHIDElementGetUsagePage(element) == kHIDPage_KeyboardOrKeypad, usage >= 0x04,
      usage <= 0xE7
    else { return }
    emit([
      "type": "hid",
      "ns": relative(IOHIDValueGetTimeStamp(value)),
      "usage": usage,
      "down": IOHIDValueGetIntegerValue(value) != 0,
      "device": property(IOHIDElementGetDevice(element), kIOHIDProductKey),
    ])
  }, nil)
IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetCurrent(), CFRunLoopMode.defaultMode.rawValue)
// 1 台でも seize されていると全体の結果は kIOReturnExclusiveAccess になる。開けた台は読める。
let hidResult = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone))

// ---------- os ----------

let kinds: [CGEventType: String] = [.keyDown: "down", .keyUp: "up", .flagsChanged: "flags"]
let mask =
  (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)
  | (1 << CGEventType.flagsChanged.rawValue)
let tap = CGEvent.tapCreate(
  tap: .cghidEventTap, place: .headInsertEventTap, options: .listenOnly,
  eventsOfInterest: CGEventMask(mask),
  callback: { _, type, event, _ in
    guard let kind = kinds[type] else {
      emit(["type": "warning", "message": "event tap が止まった（\(type.rawValue)）"])
      return Unmanaged.passUnretained(event)
    }
    var length = 0
    var chars = [UniChar](repeating: 0, count: 4)
    event.keyboardGetUnicodeString(
      maxStringLength: 4, actualStringLength: &length, unicodeString: &chars)
    emit([
      "type": "os",
      "ns": relative(event.timestamp),
      "kind": kind,
      "keycode": event.getIntegerValueField(.keyboardEventKeycode),
      "flags": event.flags.rawValue,
      "chars": String(utf16CodeUnits: chars, count: length),
      "repeat": event.getIntegerValueField(.keyboardEventAutorepeat) != 0,
    ])
    return Unmanaged.passUnretained(event)
  }, userInfo: nil)
if let tap {
  CFRunLoopAddSource(
    CFRunLoopGetCurrent(), CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0), .commonModes)
  CGEvent.tapEnable(tap: tap, enable: true)
}

emit([
  "type": "start",
  "originNs": String(origin),
  "seconds": seconds,
  "hidResult": hidResult,
  "hidNotPermitted": hidResult == kIOReturnNotPermitted,
  "tapOk": tap != nil,
])

// ---------- 終了 ----------

var signalSources: [DispatchSourceSignal] = []
for signalNumber in [SIGINT, SIGTERM] {
  signal(signalNumber, SIG_IGN)
  let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
  source.setEventHandler { CFRunLoopStop(CFRunLoopGetMain()) }
  source.resume()
  signalSources.append(source)
}

CFRunLoopRunInMode(CFRunLoopMode.defaultMode, seconds, false)
emit(["type": "end"])
