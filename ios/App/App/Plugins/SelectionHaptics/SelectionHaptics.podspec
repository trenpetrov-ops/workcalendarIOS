Pod::Spec.new do |s|
  s.name = 'SelectionHaptics'
  s.version = '0.0.1'
  s.summary = 'iOS keyboard-like haptics'
  s.license = 'MIT'
  s.author = 'you'
  s.source = { :git => '.' }
  s.source_files = 'SelectionHaptics.swift'
  s.dependency 'Capacitor'
end
