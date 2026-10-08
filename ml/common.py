"""Shared CodeBERT preprocessing and frozen embedding helpers."""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

MODEL_ID = "microsoft/codebert-base"
MODEL_REVISION = "3b0952feddeffad0063f274080e3c23d75e7eb39"
FEATURE_DIMENSION = 768
MAX_TOKEN_LENGTH = 512
EMBEDDING_BATCH_SIZE = 16


def clean_code(code: str) -> str:
    """Match the notebook's preprocessing by collapsing all whitespace."""
    return " ".join(code.split())


def load_encoder(device: torch.device) -> tuple[object, torch.nn.Module]:
    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
    )
    model = AutoModel.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
    ).to(device)
    model.eval()
    return tokenizer, model


def embed_codes(
    codes: Sequence[str],
    tokenizer: object,
    model: torch.nn.Module,
    device: torch.device,
    batch_size: int = EMBEDDING_BATCH_SIZE,
) -> np.ndarray:
    vectors: list[np.ndarray] = []
    for start in range(0, len(codes), batch_size):
        batch = [clean_code(code) for code in codes[start : start + batch_size]]
        tokens = tokenizer(
            batch,
            padding=True,
            truncation=True,
            max_length=MAX_TOKEN_LENGTH,
            return_tensors="pt",
        ).to(device)
        with torch.inference_mode():
            output = model(**tokens)
        mask = tokens["attention_mask"].unsqueeze(-1).to(output.last_hidden_state.dtype)
        pooled = (output.last_hidden_state * mask).sum(dim=1) / mask.sum(dim=1)
        vectors.append(pooled.cpu().numpy())

    if not vectors:
        return np.empty((0, FEATURE_DIMENSION), dtype=np.float32)
    return np.vstack(vectors)
