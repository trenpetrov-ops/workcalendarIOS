import Foundation
import Capacitor
import AudioToolbox

@objc(SelectionHaptics)
public class SelectionHaptics: CAPPlugin {

    @objc func keyboard(_ call: CAPPluginCall) {
        // Системный звук клавиатуры
        AudioServicesPlaySystemSound(1104)
        call.resolve()
    }

    @objc func soft(_ call: CAPPluginCall) {
        let generator = UIImpactFeedbackGenerator(style: .soft)
        generator.prepare()
        generator.impactOccurred()
        call.resolve()
    }

    @objc func rigid(_ call: CAPPluginCall) {
        let generator = UIImpactFeedbackGenerator(style: .rigid)
        generator.prepare()
        generator.impactOccurred()
        call.resolve()
    }
}
