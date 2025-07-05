//==============================================================================
//
// piFile
//
//==============================================================================

function piFile( binaryDataArrayBuffer )
{
    // private
    var mOffset = 0;
    var mDataView = new DataView( binaryDataArrayBuffer );
    var mArrayBuffer = binaryDataArrayBuffer;

    // public members
    var me = {};

    me.Seek = function( off ) { mOffset = off; };
    me.Tell = function() { return mOffset; };
    me.Skip = function( off ) { mOffset += off; };

    me.ReadUInt16  = function() { var res = mDataView.getUint16( mOffset, true ); mOffset+=2; return res; };
    me.ReadUInt32  = function() { var res = mDataView.getUint32( mOffset, true ); mOffset+=4; return res; };
    me.ReadUInt64  = function() { var res = me.ReadUInt32() + (me.ReadUInt32()<<32); return res; };
    me.ReadFloat32 = function() { var res = mDataView.getFloat32( mOffset, true ); mOffset+=4; return res; };
    me.ReadFloat32Array = function(n) { var src = new Float32Array(mArrayBuffer, mOffset); var res = [];  for( var i=0; i<n; i++ ) { res[i] = src[i]; } mOffset += 4*n; return res; };
    me.ReadFloat32ArrayNative = function(n) { var src = new Float32Array(mArrayBuffer, mOffset); mOffset += 4*n; return src; };

    return me;
}