import Foundation
import UIKit

public protocol Processable {
    func process(input: String) -> String
}

public class DataManager: NSObject, Processable {
    private var count: Int = 0
    public let name: String = ""

    public func process(input: String) -> String {
        return input.uppercased()
    }

    private func helper() {
    }
}

public func createManager(name: String) -> DataManager {
    return DataManager()
}
