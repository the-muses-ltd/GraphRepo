import os
from pathlib import Path

MAX_SIZE = 1024

class Parser:
    def parse(self, input_text):
        return input_text.split("\n")

def process_file(file_path):
    data = os.path.exists(file_path)
    print(data)
