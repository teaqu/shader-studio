//==============================================================================
//
// piFormats
//
//==============================================================================


// EXR exporter, impletation by Pol Jeremias
function piExportToEXR(width, height, numComponents, type, bytes)
{
    var bytesPerComponent = 0;
    if      (type=="Uint")   bytesPerComponent = 4; 
    else if (type=="Half")   bytesPerComponent = 2;
    else if (type=="Float")  bytesPerComponent = 4;

    var tHeader = 258 + (18 * numComponents + 1);
    var tTable = 8 * height;
    var tScanlines = height * (4 + 4 + (numComponents * bytesPerComponent * width));
    var tTotal = tHeader + tTable + tScanlines;

    //console.log("    header size = " + tHeader);
    //console.log("    table size = " + tTable);
    //console.log("    scanlines size = " + tScanlines);
    //console.log("    total = " + tTotal);

    var buffer = new ArrayBuffer(tTotal); 
    var data = new DataView(buffer);

    // Header
    {
        // Header : 4 bytes -> 0x76, 0x2f, 0x31, 0x01
        var c = 0;
        data.setUint8 (c++, 0x76);
        data.setUint8 (c++, 0x2f);
        data.setUint8 (c++, 0x31);
        data.setUint8 (c++, 0x01);

        // Version : 4 bytes -> 2, 0, 0, 0
        data.setUint8 (c++, 0x02);
        data.setUint8 (c++, 0x0);
        data.setUint8 (c++, 0x0);
        data.setUint8 (c++, 0x0);
        
        // Write channel info
        // Write attribute name : "channels"
            data.setUint8 (c++, 0x63); 
            data.setUint8 (c++, 0x68); 
            data.setUint8 (c++, 0x61); 
            data.setUint8 (c++, 0x6e); 
            data.setUint8 (c++, 0x6e); 
            data.setUint8 (c++, 0x65); 
            data.setUint8 (c++, 0x6c); 
            data.setUint8 (c++, 0x73);
            data.setUint8 (c++, 0x0);

            // Write attribute type : "chlist"
            data.setUint8 (c++, 0x63); 
            data.setUint8 (c++, 0x68); 
            data.setUint8 (c++, 0x6c); 
            data.setUint8 (c++, 0x69); 
            data.setUint8 (c++, 0x73); 
            data.setUint8 (c++, 0x74); 
            data.setUint8 (c++, 0x00);

            // Write attribute size : 18 x 3 + 1 = 55
            var attribSize = 18 * numComponents + 1;
            data.setUint8 (c++, attribSize); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00);

            var i;
            for (i = 0; i < numComponents; i++)
            {
                // Attribute : "B" (42) "G" (47) "R" (52)
                if (i==0)       data.setUint8 (c++, 0x42);
                else if (i==1)  data.setUint8 (c++, 0x47);
                else if (i==2)  data.setUint8 (c++, 0x52);
                data.setUint8 (c++, 0x00);
                
                // Value : Float (2), Half (1), Uint (0)
                if      (type=="Uint")   data.setUint8 (c++, 0x00); 
                else if (type=="Half")   data.setUint8 (c++, 0x01);
                else if (type=="Float")  data.setUint8 (c++, 0x02);
                data.setUint8 (c++, 0x00);
                data.setUint8 (c++, 0x00);
                data.setUint8 (c++, 0x00);

                // Plinear
                data.setUint8 (c++, 0x01);

                // Reserved
                data.setUint8 (c++, 0x00); 
                data.setUint8 (c++, 0x00); 
                data.setUint8 (c++, 0x00); 

                // X sampling
                data.setUint8 (c++, 0x01); 
                data.setUint8 (c++, 0x00); 
                data.setUint8 (c++, 0x00); 
                data.setUint8 (c++, 0x00); 
                
                // Y sampling
                data.setUint8 (c++, 0x01);
                data.setUint8 (c++, 0x00);
                data.setUint8 (c++, 0x00);
                data.setUint8 (c++, 0x00);
            }
            // End attribute
            data.setUint8 (c++, 0x00);
    
        // Write attribute name : "compression"
            data.setUint8 (c++, 0x63); 
            data.setUint8 (c++, 0x6f); 
            data.setUint8 (c++, 0x6d); 
            data.setUint8 (c++, 0x70); 
            data.setUint8 (c++, 0x72); 
            data.setUint8 (c++, 0x65); 
            data.setUint8 (c++, 0x73); 
            data.setUint8 (c++, 0x73); 
            data.setUint8 (c++, 0x69); 
            data.setUint8 (c++, 0x6f); 
            data.setUint8 (c++, 0x6e); 
            data.setUint8 (c++, 0x00);

            // Write attribute type : "compression"
            data.setUint8 (c++, 0x63); 
            data.setUint8 (c++, 0x6f); 
            data.setUint8 (c++, 0x6d); 
            data.setUint8 (c++, 0x70); 
            data.setUint8 (c++, 0x72); 
            data.setUint8 (c++, 0x65); 
            data.setUint8 (c++, 0x73); 
            data.setUint8 (c++, 0x73); 
            data.setUint8 (c++, 0x69); 
            data.setUint8 (c++, 0x6f); 
            data.setUint8 (c++, 0x6e); 
            data.setUint8 (c++, 0x00);

            // Write attribute size : "1"
            data.setUint8 (c++, 0x01); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00);

            // Write attribute value : "0" (None)
            data.setUint8 (c++, 0x00);

        // datawindow
            data.setUint8 (c++, 0x64); 
            data.setUint8 (c++, 0x61); 
            data.setUint8 (c++, 0x74); 
            data.setUint8 (c++, 0x61); 
            data.setUint8 (c++, 0x57); 
            data.setUint8 (c++, 0x69); 
            data.setUint8 (c++, 0x6e); 
            data.setUint8 (c++, 0x64); 
            data.setUint8 (c++, 0x6f); 
            data.setUint8 (c++, 0x77); 
            data.setUint8 (c++, 0x00); 

            // box2i
            data.setUint8 (c++, 0x62); 
            data.setUint8 (c++, 0x6f); 
            data.setUint8 (c++, 0x78); 
            data.setUint8 (c++, 0x32); 
            data.setUint8 (c++, 0x69); 
            data.setUint8 (c++, 0x00);

            // size 16
            data.setUint8 (c++, 0x10); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00);

            // value 0 0 3 2
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 

            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            
            data.setUint32 (c, width-1, true);
            c += 4;
            
            data.setUint32 (c, height-1, true); 
            c += 4;

        // displayWindow
            data.setUint8 (c++, 0x64); 
            data.setUint8 (c++, 0x69); 
            data.setUint8 (c++, 0x73); 
            data.setUint8 (c++, 0x70); 
            data.setUint8 (c++, 0x6c); 
            data.setUint8 (c++, 0x61); 
            data.setUint8 (c++, 0x79); 
            data.setUint8 (c++, 0x57); 
            data.setUint8 (c++, 0x69); 
            data.setUint8 (c++, 0x6e); 
            data.setUint8 (c++, 0x64); 
            data.setUint8 (c++, 0x6f); 
            data.setUint8 (c++, 0x77); 
            data.setUint8 (c++, 0x00);

            // box2i
            data.setUint8 (c++, 0x62); 
            data.setUint8 (c++, 0x6f); 
            data.setUint8 (c++, 0x78); 
            data.setUint8 (c++, 0x32); 
            data.setUint8 (c++, 0x69); 
            data.setUint8 (c++, 0x00); 

            // size 16
            data.setUint8 (c++, 0x10); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00);

            // value 0 0 3 2
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            
            data.setUint32 (c, width-1, true);
            c += 4;
            
            data.setUint32 (c, height-1, true); 
            c += 4;

        // lineOrder
            data.setUint8 (c++, 0x6c); 
            data.setUint8 (c++, 0x69); 
            data.setUint8 (c++, 0x6e); 
            data.setUint8 (c++, 0x65); 
            data.setUint8 (c++, 0x4f); 
            data.setUint8 (c++, 0x72); 
            data.setUint8 (c++, 0x64); 
            data.setUint8 (c++, 0x65); 
            data.setUint8 (c++, 0x72); 
            data.setUint8 (c++, 0x00); 
            
            // lineOrder
            data.setUint8 (c++, 0x6c); 
            data.setUint8 (c++, 0x69); 
            data.setUint8 (c++, 0x6e); 
            data.setUint8 (c++, 0x65); 
            data.setUint8 (c++, 0x4f); 
            data.setUint8 (c++, 0x72); 
            data.setUint8 (c++, 0x64); 
            data.setUint8 (c++, 0x65); 
            data.setUint8 (c++, 0x72); 
            data.setUint8 (c++, 0x00); 
            
            // size
            data.setUint8 (c++, 0x01);
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00);
            
            // value 
            data.setUint8 (c++, 0x00);

        // PixelAspectRatio
            data.setUint8 (c++, 0x70); 
            data.setUint8 (c++, 0x69); 
            data.setUint8 (c++, 0x78); 
            data.setUint8 (c++, 0x65); 
            data.setUint8 (c++, 0x6c); 
            data.setUint8 (c++, 0x41); 
            data.setUint8 (c++, 0x73); 
            data.setUint8 (c++, 0x70); 
            data.setUint8 (c++, 0x65); 
            data.setUint8 (c++, 0x63); 
            data.setUint8 (c++, 0x74); 
            data.setUint8 (c++, 0x52); 
            data.setUint8 (c++, 0x61); 
            data.setUint8 (c++, 0x74); 
            data.setUint8 (c++, 0x69); 
            data.setUint8 (c++, 0x6f); 
            data.setUint8 (c++, 0x00); 

            // float
            data.setUint8 (c++, 0x66); 
            data.setUint8 (c++, 0x6c); 
            data.setUint8 (c++, 0x6f); 
            data.setUint8 (c++, 0x61); 
            data.setUint8 (c++, 0x74); 
            data.setUint8 (c++, 0x00);
        
            // size 4
            data.setUint8 (c++, 0x04); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00);

            // value 1.0
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x80); 
            data.setUint8 (c++, 0x3f);
        
        // screenWindowCenter
            data.setUint8 (c++, 0x73); 
            data.setUint8 (c++, 0x63);
            data.setUint8 (c++, 0x72); 
            data.setUint8 (c++, 0x65); 
            data.setUint8 (c++, 0x65); 
            data.setUint8 (c++, 0x6e); 
            data.setUint8 (c++, 0x57); 
            data.setUint8 (c++, 0x69); 
            data.setUint8 (c++, 0x6e); 
            data.setUint8 (c++, 0x64); 
            data.setUint8 (c++, 0x6f); 
            data.setUint8 (c++, 0x77); 
            data.setUint8 (c++, 0x43); 
            data.setUint8 (c++, 0x65); 
            data.setUint8 (c++, 0x6e);
            data.setUint8 (c++, 0x74); 
            data.setUint8 (c++, 0x65); 
            data.setUint8 (c++, 0x72); 
            data.setUint8 (c++, 0x00);

            // v2f
            data.setUint8 (c++, 0x76); 
            data.setUint8 (c++, 0x32); 
            data.setUint8 (c++, 0x66); 
            data.setUint8 (c++, 0x00);

            // size 8
            data.setUint8 (c++, 0x08); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00);

            // value 0 0
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00);

        // screenWindowWidth
            data.setUint8 (c++, 0x73); 
            data.setUint8 (c++, 0x63); 
            data.setUint8 (c++, 0x72); 
            data.setUint8 (c++, 0x65); 
            data.setUint8 (c++, 0x65); 
            data.setUint8 (c++, 0x6e); 
            data.setUint8 (c++, 0x57); 
            data.setUint8 (c++, 0x69); 
            data.setUint8 (c++, 0x6e); 
            data.setUint8 (c++, 0x64); 
            data.setUint8 (c++, 0x6f); 
            data.setUint8 (c++, 0x77); 
            data.setUint8 (c++, 0x57); 
            data.setUint8 (c++, 0x69); 
            data.setUint8 (c++, 0x64); 
            data.setUint8 (c++, 0x74); 
            data.setUint8 (c++, 0x68); 
            data.setUint8 (c++, 0x00); 
            
            // float
            data.setUint8 (c++, 0x66); 
            data.setUint8 (c++, 0x6c); 
            data.setUint8 (c++, 0x6f); 
            data.setUint8 (c++, 0x61); 
            data.setUint8 (c++, 0x74); 
            data.setUint8 (c++, 0x00); 

            // size
            data.setUint8 (c++, 0x04); 
            data.setUint8 (c++, 0x00);
            data.setUint8 (c++, 0x00);
            data.setUint8 (c++, 0x00);

            // value
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x00); 
            data.setUint8 (c++, 0x80); 
            data.setUint8 (c++, 0x3f);

        // End of header
        data.setUint8 (c++, 0x00);
    }
    //console.log("header size = " + c);

    // Scanline table
    var initc = c + height * 8;
    for (var scanline = 0 ; scanline < height ; scanline ++)
    {
        var jump = initc + scanline * (8 + width * bytesPerComponent * numComponents); 
        data.setUint32 (c, jump, true);
        c += 4; 

        data.setUint32 (c, 0x00, true);
        c += 4;
    }
    //console.log("header + scanlines table size = " + c);

    // Scanlines
    for (var scanline = 0 ; scanline < height ; scanline ++)
    {
        // Scanline
        data.setUint32(c, scanline, true);
        c += 4;

        // size 24
        var size = width * numComponents * bytesPerComponent; 
        data.setUint32(c, size, true);
        c += 4;

        var numComponentsSource = 4; // number of components in the SOURCE image
        for (var component = 0; component < numComponents ; component ++) 
        {
            for (var pixel = 0 ; pixel < width ; pixel ++) 
            {
                // flip vertical, so we read OpenGL buffers without JS image flipping
                var v = bytes[(height-1-scanline) * width *numComponentsSource + pixel * numComponentsSource + (2-component)];
                if      (type=="Float") data.setFloat32(c, v, true);
                else if (type=="Half")  data.setUint16(c, v, true);

                c += bytesPerComponent;
            }
        }
    }
    //console.log("total size = " + c);
    var blob = new Blob([buffer], {type: 'application/octet-stream'});
    return blob;
}


function piExportToWAV(numSamples, rate, bits, numChannels, words)
{
    let numBytes = numSamples * numChannels * bits/8;

    let buffer = new ArrayBuffer(44 + numBytes); 
    let data = new DataView(buffer);

    {
        data.setUint32( 0, 0x46464952, true );  // RIFF
        data.setUint32( 4, numBytes + 36, true);
        {
            data.setUint32( 8, 0x45564157, true );  // WAV_WAVE
            data.setUint32( 12, 0x20746D66, true );  // WAV_FMT
            {
                data.setUint32( 16, 16, true);
                data.setUint16( 20, 1, true ); // WAV_FORMAT_PCM
                data.setUint16( 22, numChannels, true);
                data.setUint32( 24, rate, true);
                data.setUint32( 28, rate*numChannels*bits / 8, true);
                data.setUint16( 32, numChannels*bits / 8, true);
                data.setUint16( 34, bits, true);
            }

            data.setUint32( 36, 0x61746164, true);  // WAV_DATA
            {
                data.setUint32( 40, numBytes, true);
                let numWords = numSamples * numChannels;
                for(let i=0; i<numWords; i++ )
                {
                    data.setInt16( 44 + i*2, words[i], true );
                }
            }
        }
    }


    //console.log("total size = " + c);
    return new Blob([buffer], {type: 'application/octet-stream'});
}
