import torch
from toolkit.basic import flush
from typing import TYPE_CHECKING


if TYPE_CHECKING:
    from toolkit.models.base_model import BaseModel


class FakeTextEncoder(torch.nn.Module):
    def __init__(self, device, dtype, config=None):
        super().__init__()
        # register a dummy parameter to avoid errors in some cases
        self.dummy_param = torch.nn.Parameter(torch.zeros(1))
        self._device = device
        self._dtype = dtype
        # Preserve the original text encoder's config so downstream code
        # that accesses .config (e.g. hidden_size, d_model) still works.
        self.config = config

    def forward(self, *args, **kwargs):
        raise NotImplementedError(
            "This is a fake text encoder and should not be used for inference."
        )
        return None

    @property
    def device(self):
        return self._device
    
    @property
    def dtype(self):
        return self._dtype
    
    def to(self, *args, **kwargs):
        return self


def unload_text_encoder(model: "BaseModel"):
    # unload the text encoder in a way that will work with all models and will not throw errors
    # we need to make it appear as a text encoder module without actually having one so all
    # to functions and what not will work.

    if model.text_encoder is not None:
        if isinstance(model.text_encoder, list):
            text_encoder_list = []
            pipe = model.pipeline

            # the pipeline stores text encoders like text_encoder, text_encoder_2, text_encoder_3, etc.
            if hasattr(pipe, "text_encoder"):
                orig_config = getattr(pipe.text_encoder, 'config', None)
                te = FakeTextEncoder(device=model.device_torch, dtype=model.torch_dtype, config=orig_config)
                text_encoder_list.append(te)
                pipe.text_encoder.to('cpu')
                pipe.text_encoder = te

            i = 2
            while hasattr(pipe, f"text_encoder_{i}"):
                orig_te = getattr(pipe, f"text_encoder_{i}")
                orig_config = getattr(orig_te, 'config', None)
                te = FakeTextEncoder(device=model.device_torch, dtype=model.torch_dtype, config=orig_config)
                text_encoder_list.append(te)
                setattr(pipe, f"text_encoder_{i}", te)
                i += 1
            model.text_encoder = text_encoder_list
        else:
            # only has a single text encoder
            orig_config = getattr(model.text_encoder, 'config', None)
            model.text_encoder = FakeTextEncoder(device=model.device_torch, dtype=model.torch_dtype, config=orig_config)

    flush()
