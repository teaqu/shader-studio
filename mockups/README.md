# UI mockups

Open `shader-configuration.html` in a browser to revisit the interactive shader configuration design. `shader-configuration.fragment.html` is its editable source.

This is a design reference, not the running application. Shader functions, files, previews and inferred outputs are sample data. Changes stay in the browser preview. Buffer B and GBufferFragment demonstrate multiple named outputs. Only Misc is mocked in the channel editor; the other channel editors retain their existing product UI.

The design groups source files and selectable function rows by stage, followed by Channels, Geometry, Rendering, Resolution and Output. Image uses the main shader file. Output slots and default names come from the selected fragment function; configuration does not create outputs. Attachment slots must be contiguous from zero. Existing configured names can override inferred field names; they do not change the number of attachments.

The standalone preview includes its presentation runtime; fonts/icons may require network access. Keep mockups separate from application code and tests.
