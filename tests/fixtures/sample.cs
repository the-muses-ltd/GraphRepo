using System;
using System.Collections.Generic;

public interface IProcessor {
    void Process(string input);
}

public abstract class BaseProcessor {
    public abstract void Initialize();
}

public class DataProcessor : BaseProcessor, IProcessor {
    private int _count;

    public void Process(string input) {
        Console.WriteLine(input);
    }

    public async Task FetchAsync(string url) {
    }
}
