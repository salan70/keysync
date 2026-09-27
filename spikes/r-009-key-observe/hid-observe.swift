// R-009 Spike: Karabiner が内蔵キーボードを seize している間に、IOHID で物理キーの押下を横から読めるか。
//
// 使い方: swift spikes/r-009-key-observe/hid-observe.swift [秒数]
// 何も書き込まない。キーボード（usage page 1 / usage 6）を seize せずに開き、
// Keyboard/Keypad page（0x07）の値の変化を 1 行 1 JSON で標準出力へ出す。

import Foundation
import IOKit.hid

let seconds = Double(CommandLine.arguments.dropFirst().first ?? "") ?? 15

var timebase = mach_timebase_info_data_t()
mach_timebase_info(&timebase)
func nanoseconds(_ machTime: UInt64) -> UInt64 {
  machTime * UInt64(timebase.numer) / UInt64(timebase.denom)
}

func property(_ device: IOHIDDevice, _ key: String) -> String {
  guard let value = IOHIDDeviceGetProperty(device, key as CFString) else { return "" }
  return "\(value)"
}

func emit(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
    let line = String(data: data, encoding: .utf8)
  else { return }
  print(line)
  fflush(stdout)
}

let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
IOHIDManagerSetDeviceMatching(
  manager,
  [kIOHIDDeviceUsagePageKey: kHIDPage_GenericDesktop, kIOHIDDeviceUsageKey: kHIDUsage_GD_Keyboard]
    as CFDictionary)

IOHIDManagerRegisterDeviceMatchingCallback(
  manager,
  { _, result, _, device in
    // デバイスごとに seize せずに開き、Karabiner の seize と両立するかを見る。
    let opened = IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeNone))
    emit([
      "deviceOpen": opened,
      "deviceOpenOk": opened == kIOReturnSuccess,
      "type": "device",
      "product": property(device, kIOHIDProductKey),
      "transport": property(device, kIOHIDTransportKey),
      "builtIn": property(device, "Built-In"),
      "vendorId": property(device, kIOHIDVendorIDKey),
      "productId": property(device, kIOHIDProductIDKey),
      "result": result,
    ])
  }, nil)

IOHIDManagerRegisterInputValueCallback(
  manager,
  { _, _, _, value in
    let element = IOHIDValueGetElement(value)
    let page = IOHIDElementGetUsagePage(element)
    let usage = IOHIDElementGetUsage(element)
    guard page == kHIDPage_KeyboardOrKeypad, usage >= 0x04, usage <= 0xE7 else { return }
    let device = IOHIDElementGetDevice(element)
    emit([
      "type": "hid",
      "product": property(device, kIOHIDProductKey),
      "usage": usage,
      "down": IOHIDValueGetIntegerValue(value) != 0,
      "ns": nanoseconds(IOHIDValueGetTimeStamp(value)),
    ])
  }, nil)

IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetCurrent(), CFRunLoopMode.defaultMode.rawValue)
let opened = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone))
emit([
  "type": "open", "result": opened, "ok": opened == kIOReturnSuccess,
  "notPermitted": opened == kIOReturnNotPermitted,
  "exclusiveAccess": opened == kIOReturnExclusiveAccess, "seconds": seconds,
])

CFRunLoopRunInMode(CFRunLoopMode.defaultMode, seconds, false)
emit(["type": "end"])
