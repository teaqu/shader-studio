# Native multiple render targets

The WGSL and Slang `two-outputs` examples return structured native fragment
outputs at locations 0 and 1, deliberately declared out of field order. Their
configs label the colour and normal targets; downstream Buffer/Image inputs can
select either with `output: 0` or `output: 1`.

`five-outputs` writes five distinct values and routes all five into Image RGB. It
requires a device supporting at least five color attachments and 40 bytes per
sample. Both examples keep Image and Buffer functions in the same source file.
