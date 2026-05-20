"""Pytest configuration: stub mesh_pipeline before any test import.

Prevents pymeshlab and pythonocc-core from being loaded during the test suite.
"""
from sys import modules
from unittest.mock import MagicMock

modules.setdefault("mesh_pipeline", MagicMock())
