import os
import sys
from pathlib import Path

for prefixe in ("ETAT_CIVIL", "JUSTICE", "NATIONALITE"):
    os.environ.setdefault(f"{prefixe}_SECRET", "secret-de-test")
    os.environ.setdefault(f"{prefixe}_CONSOLE_JETON", "jeton-test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
