import AppKit
import AVFoundation
import CoreVideo
import Foundation

let destination = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "artifacts/radio88-store/public/demo/homepage", isDirectory: true)
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)

func writePoster(_ name: String, width: Int, height: Int, gray: Bool) throws {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSColor(calibratedWhite: gray ? 0.851 : 0, alpha: 1).setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()
    NSGraphicsContext.restoreGraphicsState()
    try rep.representation(using: .png, properties: [:])!.write(to: destination.appendingPathComponent(name), options: .atomic)
}

func makeVideo(_ name: String, width: Int, height: Int) throws {
    let output = destination.appendingPathComponent(name)
    try? FileManager.default.removeItem(at: output)
    let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 560_000, AVVideoMaxKeyFrameIntervalKey: 30],
    ])
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
        kCVPixelBufferCGImageCompatibilityKey as String: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
    ])
    guard writer.canAdd(input) else { throw NSError(domain: "DemoMedia", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot add H.264 video input"]) }
    writer.add(input)
    writer.startWriting()
    writer.startSession(atSourceTime: .zero)

    let fps: Int32 = 15
    let frames = Int(fps) * 10
    for frame in 0..<frames {
        while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.005) }
        var optionalBuffer: CVPixelBuffer?
        let status = CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32ARGB, [
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true,
        ] as CFDictionary, &optionalBuffer)
        guard status == kCVReturnSuccess, let buffer = optionalBuffer else { throw NSError(domain: "DemoMedia", code: 2, userInfo: [NSLocalizedDescriptionKey: "Cannot allocate video frame"]) }
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
        context.setFillColor(NSColor.black.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let t = Double(frame) / Double(fps)
        for i in 0..<110 {
            let seed = Double(i)
            let baseX = (seed * 0.61803398875).truncatingRemainder(dividingBy: 1)
            let baseY = (seed * 0.75487766625).truncatingRemainder(dividingBy: 1)
            let drift = (t * (0.008 + Double(i % 5) * 0.002)).truncatingRemainder(dividingBy: 1)
            let x = (baseX + drift).truncatingRemainder(dividingBy: 1) * Double(width)
            let y = (baseY + sin(t * 0.45 + seed) * 0.008).truncatingRemainder(dividingBy: 1) * Double(height)
            let size = i % 13 == 0 ? 2.2 : (i % 3 == 0 ? 1.3 : 0.8)
            let alpha = i % 7 == 0 ? 0.95 : (i % 4 == 0 ? 0.68 : 0.38)
            context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: alpha))
            context.fillEllipse(in: CGRect(x: x, y: y, width: size, height: size))
            if i % 19 == 0 {
                context.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.16))
                context.setLineWidth(0.6)
                context.move(to: CGPoint(x: x - 5, y: y))
                context.addLine(to: CGPoint(x: x + 5, y: y))
                context.strokePath()
            }
        }
        let time = CMTime(value: Int64(frame), timescale: fps)
        guard adaptor.append(buffer, withPresentationTime: time) else { throw writer.error ?? NSError(domain: "DemoMedia", code: 3, userInfo: [NSLocalizedDescriptionKey: "Cannot encode video frame"]) }
    }
    input.markAsFinished()
    let semaphore = DispatchSemaphore(value: 0)
    writer.finishWriting { semaphore.signal() }
    semaphore.wait()
    guard writer.status == .completed else { throw writer.error ?? NSError(domain: "DemoMedia", code: 4, userInfo: [NSLocalizedDescriptionKey: "Video encoding failed"]) }
}

try writePoster("cinza-desktop.png", width: 1920, height: 960, gray: true)
try writePoster("cinza-mobile.png", width: 960, height: 1200, gray: true)
try writePoster("estrelas-poster-desktop.png", width: 1920, height: 960, gray: false)
try writePoster("estrelas-poster-mobile.png", width: 960, height: 1200, gray: false)
try makeVideo("estrelas-desktop.mp4", width: 1280, height: 640)
try makeVideo("estrelas-mobile.mp4", width: 720, height: 900)
print("Demo media written to \(destination.path)")
