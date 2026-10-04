# GPU storage workspace

`gpu-storage.html` preserves the agreed interactive design. Open it in a browser to explore Settings and Inspect. Values in this wireframe are sample data; the application inspector reads the GPU.

The implementation uses a buffer list, Settings/Inspect tabs, compact vector tables, scalar lists and one selected struct field at a time. Field selection is remembered per shader and buffer. Comparing fields is intentionally outside this design.

Storage settings support config-owned numeric struct fields or existing source types, embedded binary initial data (up to 256 KiB), clearing between frames and reset-on-restart. Pass bindings describe the shared storage access provided by the renderer; they are informational.

The inspector supports snapshots, live updates up to twice per second, before/after pass captures, frame context, range navigation and hexadecimal integers. Matrices, nested structs and arrays remain valid shader types, but are not displayed as numeric fields yet.

The application adds a header Apply action for pending settings and labels immediate reads Latest values. Capture choices exclude passes marked Run once. The maintained user guide is [GPU Storage](../docs/features/storage.md).
