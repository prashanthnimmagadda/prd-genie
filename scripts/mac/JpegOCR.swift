import Foundation
import ImageIO
import Vision

let data = FileHandle.standardInput.readDataToEndOfFile()
guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
  fputs("Invalid JPEG image\n", stderr)
  exit(2)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

do {
  try VNImageRequestHandler(cgImage: image).perform([request])
} catch {
  fputs("Vision recognition failed: \(error)\n", stderr)
  exit(3)
}

for observation in request.results ?? [] {
  if let candidate = observation.topCandidates(1).first {
    print(candidate.string)
  }
}
