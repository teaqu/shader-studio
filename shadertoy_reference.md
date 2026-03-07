
<!DOCTYPE HTML>
<html lang="en">
<head>
    
<title>Shadertoy BETA</title>
<meta charset="utf-8" />
<meta name="Keywords" content="shadertoy, shader toy, quilez, inigo, jeremias, pol, fractals, demoscene, computer graphics, mathematics, rendering, demo, 3D, realtime, shader, raytracing, raymarching, webgl, glsl" />
<meta name="Description" content="Build shaders, share them, and learn from the best community." />
<meta name="Author" content="Beautypi" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />

<link rel="image_src" href="https://www.shadertoy.com/img/logo.png" />
<link rel="apple-touch-icon" href="/img/launch_icon_57.png"/>
<link rel="apple-touch-icon" sizes="72x72" href="/img/launch_icon_72.png"/>
<link rel="apple-touch-icon" sizes="114x114" href="/img/launch_icon_114.png"/>
<link rel="shortcut icon" href="/img/favicon.ico"/>

<style>*
{
    box-sizing: border-box;
}

::-webkit-scrollbar {
    height: 8px;
    width: 8px;
    background: #404040;
}

::-webkit-scrollbar-thumb
{
    background: #909090;
    border-radius: 0ex;
}

::-webkit-scrollbar-corner
{
    background: #000;
}

::-webkit-input-placeholder
{
	font-style:italic;
}
input:-moz-placeholder, textarea:-moz-placeholder
{
	font-style:italic;
}
input.placeholder-text, textarea.placeholder-text
{
	font-style:italic;
}

pre 
{
    white-space: pre-wrap;
    white-space: -moz-pre-wrap;
    white-space: -pre-wrap;
    white-space: -o-pre-wrap;
    word-wrap: break-word;
}

@font-face
{
    font-family: Lobster;
    src: url("/img/lobster.otf") format("opentype");
}

div#centerScreen
{
    left: 50%;
    top: 50%;
    position: absolute;
}

a.headerLinks:hover
{
    background-color:#505050;
    color : #ff8020;
}

body
{
    color: #000000;
    font-size:12px;
    font-style:normal;
    font-family:Tahoma,Arial;
    background-repeat: no-repeat;
    //background-attachment: fixed;
    padding:0px;
    margin:0px;
    text-align: left;
    background-color: #d0d0d0;
    background-repeat: repeat;
    user-select: text;
}

a,
a:hover,
a:visited
{
  color : inherit;
}

div#content {
    width: 95%;
    overflow: hidden;
    margin: auto;
    padding: 0px;
    min-height: calc(100vh - 80px);
}


.notificationCount
{
 background-color:#ff0000;
 padding-left:3px;
 padding-right:1px;
 padding-top:1px;
 padding-bottom:1px;
}

div#header
{
    background-color: #404040;
    top: 0px;
    left: 0px;
    width: 100%;
    padding: 0;
    margin: 0;
    color: #ffffff;
    display: flex;
    flex-direction:row;
}

#headerBlock1
{
    width: 50%;
    display:flex;
    align-items:center;
}

a#headerTitle
{
    font-size: 2.25em;
    font-family: Lobster,Tahoma,Arial;
    text-decoration: none;
    padding-left:32px;
    padding-right:32px;
}

#headerSearch
{
    display: inline-block;
    color: #000000;
    width: 300px;
}

input[type=search]#mySearch
{
    width: 100%;
    border-radius: 6px;
    border: 1px solid black;
    padding:12px;
}

#headerBlock2
{
    width: 50%;
    margin-left: auto;
    display: flex;
    justify-content: flex-end;
}


a#headerTitle:hover
{
    color : #ff8020;
}

a.headerLinks
{
    font-weight: bold;
    padding-top: 14px;
    padding-bottom: 14px;
    padding-left: 14px;
    padding-right: 14px;
    margin:0px;
    text-decoration: none;
    transition: background-color 0.15s linear, color 0.15s linear;
}

#footer
{
    background-color: rgba(64,64,64,0.25);
    color: #000000;
    padding: 0px;
    margin: 0px;
    width: 100%;
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
}

#footer div
{
    padding-top:10px;
    padding-bottom:0px;
    padding-left:16px;
    padding-right:16px;
}

#footer div ul
{
    margin-left:0px;
    padding-left:16px;
}

#footer div ul li
{
    padding-top:6px;
}

a.regular
{
    font-weight:bold;
    text-decoration:none
}

a.regular:hover
{
  color : #ff8020;
}

a.user
{
    font-weight:bold;
    text-decoration:none;
}

a.user:hover
{
  color : #ff8020;
  text-decoration: underline;
}

.uiButton
{
    border: none;
    outline: none;
    margin: 0px;
    padding: 0px;
    width: 22px;
    height: 22px;
    cursor: pointer;
    border-radius: 4px;
}

.uiButton:hover
{
    box-shadow: inset 0px 0px 1px 1px #808080, 0px 0px 1px 1px #808080;
}

.uiDivBUtton
{
    cursor:pointer;
}

.uiDivBUtton:hover
{
    color: #ffffff;
}


.dialog
{
    display: block;
    background-color: #e0e0e0;
    color: #000000;
    border:1px solid #000;
    padding:0px;
    margin:0px;
    text-align:left;
    border-radius: 4px;
    box-shadow:4px 4px 6px 0px rgba(0,0,0,0.5);
    overflow: hidden;
    z-index:1000;
    visibility: hidden;
    opacity:0;
    -moz-transition: opacity 0.25s linear,visibility 0.25s linear;
    -webkit-transition: opacity 0.25s linear,visibility 0.25s linear;
    transition: opacity 0.25s linear,visibility 0.25s linear;
}

.dialogHeader
{
    left:0px;
    top: 0px;
    width:100%;
    height:32px;
    position: absolute;
    background-color: #808080;
    cursor:move;
}

.dialogTitle
{
    left: 12px;
    top: 4px;
    position: absolute;
    padding: 0px;
    margin: 0px;
    color:#000000;
    font-size:1.5em;
    text-align: left;
    user-select: none;
    -moz-user-select: -moz-none;
    -webkit-user-select: none;
}

.dialogOverlay
{
    z-index:1000;

    visibility: hidden;
    opacity:0;
    -moz-transition: opacity 0.25s linear,visibility 0.25s linear;
    -webkit-transition: opacity 0.25s linear,visibility 0.25s linear;
    transition: opacity 0.25s linear,visibility 0.25s linear;

    left:0px;
    top:0px;
    padding:0px;
    margin:0px;
    width:100%;
    height:100%;
    position:absolute;

    background-color:rgba(0,0,0,.4);
}

.viewsIcon, .likesIcon
{
    border: none;
    outline: none;
    display:inline-block;
    background-repeat:no-repeat;
    top:0px;
    left:0px;
    padding:0px;
    padding-right: 2px;
    margin:0px;
    position:relative;
}

.userPictureSmall
{
    background-color:#808080;
    border: 1px solid #000000;
    width:32px;
    height:32px;
}

.dialogCloseButton
{
    right:8px;
    top: 4px;
    width:22px;
    height:22px;
    position: absolute;
    background-image: url("/img/close.png");
    cursor: pointer;
    border-radius: 4px;
}

.dialogCloseButton:hover
{
    box-shadow: inset 0px 0px 4px 2px #ffffff, 0px 0px 4px 2px #ffffff;
}

.dialogContentButtons
{
     padding:0;
     border:0;
     text-align: justify;
     left: 24px;
     bottom:40px;
     position:absolute;
}

.dialogButton
{
    text-align: center;
    vertical-align: middle;
    display: inline-block;
    border-radius: 4px;
    font-weight: bold;
    cursor: pointer;
    padding-bottom:5px;
    padding-top:4px;
    padding-left: 8px;
    padding-right: 8px;
    margin-left:4px;
    margin-right:4px;
    text-decoration: none;
    color:#000000;
    width: 80px;
    -moz-transition:    background-color 0.15s linear, color 0.15s linear;
    -webkit-transition: background-color 0.15s linear, color 0.15s linear;
    transition:         background-color 0.15s linear, color 0.15s linear;
}

.dialogButton:hover
{
  background-color:#808080;
  color : #ff8020;
}

.dialogCloseButton:hover
{
    box-shadow: inset 0px 0px 4px 2px #ffffff, 0px 0px 4px 2px #ffffff;
}

.dialogContent
{
    color: inherit;
    overflow: auto;
    width:100%;
    height:100%;
    left: 0px;
    top: 32px;
    position:absolute
}

.dialogContentBody
{
    color: inherit;
    width:100%;
    height:auto;
    padding-top:24px;
    padding-bottom:24px;
    padding-left:24px;
    padding-right:24px;
    text-align: left;
}

.formButton
{
    font-weight:bold;
	color:#ffffff;
	border:none;
    text-align:center;
	background-color:#808080;
    border-radius: 4px;
	padding-left:8px;
	padding-right:8px;
	padding-top:4px;
	padding-bottom:4px;
    cursor:pointer;
    min-width:80px;
}
.formInput {
    border-radius: 6px;
    border: 1px solid black;
    padding: 4px;
    border: none;
}
.formButton:hover {
    background-color: #e0e0e0;
}
.formButton:disabled
{
	color:#b0b0b0;
	background-color:#808080;
}

.formButtonSmall
{
    color:#ffffff;
    border:none;
    text-align:center;
    background-color:#808080;
    border-radius: 4px;
    padding-left:2px;
    padding-right:2px;
    padding-top:2px;
    padding-bottom:2px;
    cursor:pointer;
    min-width:40px;
}

.formButtonSmall:hover
{
    background-color: #e0e0e0;
}

.formButtonSmall:disabled
{
    color:#b0b0b0;
    background-color:#808080;
}

.formButtonSmall.disabled2,
.formButton.disabled2 { color:#b0b0b0; background-color:#808080; pointer-events: none; }

.inputForm
{
    padding-left:2%;
    padding-right:2%;
    resize: none;
    text-align: left;
    background-color:#e0e0e0;
    outline: none;
    border-radius: 4px;
    border: 1px solid #808080;
    color:inherit;
}

.inputForm:focus
{
    border: 1px solid #AFCDD8;
    background-color: #EBF2F4;
}

.transparentPannel
{
    background-color:rgba(64,64,64,0.1);
    padding:16px;
}

.comment, .commentSelf, .commentNew
{
    border-radius: 4px;
    width: 100%;
    margin-left: 0px;
    margin-right: 0px;
    margin-top: 0px;
    margin-bottom: 6px;

    padding: 14px;
    display: grid;
    grid-template-columns: 32px auto 8px;
    grid-template-rows: 1fr;
    grid-gap:8px;
}

.comment:nth-child(even)
{
    background-color: rgba(64,64,64,0.1);
}

.comment:nth-child(odd)
{
    background-color: rgba(128,128,128,0.1);
}

.commentSelf
{
    background-color: rgba(240,160,64,0.1);
}

.commentNew
{
    padding-right: 0px;
    grid-template-columns: 40px auto;
}

.commentContent
{
    vertical-align: top;
    text-align: left;
    word-break: break-all;
    word-break: break-word;
    white-space: pre-wrap;
    white-space: -moz-pre-wrap;
}


/* ----------------------- media resolutions ------------------------ */

@media screen and (max-width:799px)
{
    div#header {flex-direction:column; }
    #headerBlock1 { width:100%; }
    #headerBlock2 { width:100%; justify-content: space-around;}
    div#headerSearch {width:200px;}
    input#mySearch { width:200px; left:21px; height:22px; border-radius:6px; padding-left:8px; padding-right:8px; }
    .previewText { width:130px; }
    .transparentPannel { padding:10px; }
}

@media screen and (min-width:800px) and (max-width:1279px)
{
    body { font-size: 9px; }
    div#headerSearch {width: 250px;}
    input#mySearch { width:250px; left:21px; height:22px; border-radius:6px; padding-left:8px; padding-right:8px; }
    .previewText { width:130px; }
    .transparentPannel { padding:11px; }
}

@media screen and (min-width:1280px) and (max-width:1439px)
{
    body { font-size: 10px; }
    div#headerSearch {width: 300px;}
    input#mySearch { width:300px; left:21px; height:22px; border-radius:6px; padding-left:8px; padding-right:8px; }
    .dialogHeader { height:28px; }
    .previewText { width:180px; }
    .transparentPannel { padding:12px; }
}

@media screen and (min-width:1440px) and (max-width:1919px)
{
    div#headerSearch {width: 300px;}
    input#mySearch { width:300px; left:21px; height:22px; border-radius:6px; padding-left:8px; padding-right:8px; }
    .dialogHeader { height:28px; }
    .previewText { width:180px; }
    .transparentPannel { padding:12px; }
}

@media screen and (min-width:1920px) and (max-width:2559px)
{
    div#headerSearch {width: 300px;}
    input#mySearch { width:300px; left:21px; height:22px; border-radius:6px; padding-left:8px; padding-right:8px; }
    .dialogHeader { height:32px; }
    .previewText { width:220px; }
    .transparentPannel { padding:16px; }
}

@media screen and (min-width:2560px) 
{
    div#headerSearch {width: 300px;}
    input#mySearch { width:300px; left:21px; height:22px; border-radius:6px; padding-left:8px; padding-right:8px; }
    .dialogHeader { height:32px; }
    .previewText { width:220px; }
    .transparentPannel { padding:16px; }
}
body
{
    background-image: url("/img/themes/classic/background.jpg");
}
</style>
    <script>"use strict"

//==============================================================================
//
// piLibs 2015-2017 - http://www.iquilezles.org/www/material/piLibs/piLibs.htm
//
// piCamera
//
//==============================================================================

function piCamera()
{
    var mMatrix = setIdentity();
    var mMatrixInv = setIdentity();

    var mPosition = [0.0,0.0,0.0];
    var mXRotation = 0.0;
    var mYRotation = 0.0;

    var mPositionTarget = [0.0,0.0,0.0];
    var mXRotationTarget = 0.0;
    var mYRotationTarget = 0.0;

    var me = {};
/*
    me.Set = function( pos, dir, roll) 
             {
                 mMatrix    = setLookat( pos, add(pos,dir), [Math.sin(roll),Math.cos(roll),Math.sin(roll)] );
                 mMatrixInv = invertFast( mMatrix );
             };
*/
    me.SetPos = function(pos)
                {
                    mPosition = pos;
                    //mMatrix[ 3] = -(mMatrix[0] * pos[0] + mMatrix[1] * pos[1] + mMatrix[ 2] * pos[2]);
                    //mMatrix[ 7] = -(mMatrix[4] * pos[0] + mMatrix[5] * pos[1] + mMatrix[ 6] * pos[2]);
                    //mMatrix[11] = -(mMatrix[8] * pos[0] + mMatrix[9] * pos[1] + mMatrix[10] * pos[2]);
                };
/*
    me.GlobalMove = function(pos)
                    {
                        mMatrix[ 3] -= (mMatrix[0] * pos[0] + mMatrix[1] * pos[1] + mMatrix[ 2] * pos[2]);
                        mMatrix[ 7] -= (mMatrix[4] * pos[0] + mMatrix[5] * pos[1] + mMatrix[ 6] * pos[2]);
                        mMatrix[11] -= (mMatrix[8] * pos[0] + mMatrix[9] * pos[1] + mMatrix[10] * pos[2]);
                        mMatrixInv = invertFast(mMatrix);
                    };
*/
    me.LocalMove = function( dis )
                    {
                        dis = matMulvec( setRotationY(-mYRotation), dis);
                        mPositionTarget = sub(mPositionTarget,dis)
                    };

    me.RotateXY = function( x, y)
                  {
                    mXRotationTarget -= x;
                    mYRotationTarget -= y;
                    mXRotationTarget = Math.min( Math.max( mXRotationTarget, -Math.PI/2), Math.PI/2 );
                  };


    me.CameraExectue = function( dt )
    {
        // smooth position
        mXRotation += (mXRotationTarget-mXRotation) * 12.0*dt;
        mYRotation += (mYRotationTarget-mYRotation) * 12.0*dt;
        mPosition = add(mPosition, mul( sub(mPositionTarget, mPosition), 12.0*dt));

        // Make Camera matrix
        mMatrix = matMul( matMul(setRotationX(mXRotation), 
                                 setRotationY(mYRotation)),  
                                 setTranslation(mPosition));
        mMatrixInv = invertFast(mMatrix);

    }

    me.GetMatrix = function() { return mMatrix; };
    me.GetMatrixInverse = function() { return mMatrixInv; };
    me.SetMatrix = function( mat ) 
                    {
                        mMatrix = mat;
                        mMatrixInv = invertFast(mMatrix);

                        mPosition = getXYZ(matMulpoint(mat, [0.0,0.0,0.0]));
                        mPositionTarget = mPosition;
                    };

    me.GetPos = function() { return getXYZ(matMulpoint(mMatrixInv, [0.0,0.0,0.0])); }
    me.GetDir = function() { return getXYZ(normalize(matMulvec(mMatrixInv, [0.0,0.0,-1.0]))); }

    return me;
}
//==============================================================================
//
// piLibs 2015-2017 - http://www.iquilezles.org/www/material/piLibs/piLibs.htm
//
// piFile
//
//==============================================================================

function piFile( binaryDataArrayBuffer )
{
    // private
    //var mDataView = new DataView( binaryDataArrayBuffer, 0 );
    var mDataView = binaryDataArrayBuffer;
    var mOffset = 0;

    // public members
    var me = {};
    me.mDummy = 0;
/*
    // public functions
    me.Seek = function( off ) { mOffset = off - 3; };
    me.ReadUInt16 = function()  { var res = mDataView.getUint16( mOffset ); mOffset+=2; return res; };
    me.ReadUInt32 = function()  { var res = mDataView.getUint32( mOffset ); mOffset+=4; return res; };
    me.ReadUInt64 = function()  { return me.ReadUInt32() + (me.ReadUInt32()<<32); };
    me.ReadFloat32 = function() { var res = mDataView.getFloat32( mOffset ); mOffset+=4; return res; };
*/

    me.Seek = function( off ) { mOffset = off; };
    me.ReadUInt8  = function()  { var res = (new Uint8Array(mDataView,mOffset))[0]; mOffset+=1; return res; };
    me.ReadUInt16 = function()  { var res = (new Uint16Array(mDataView,mOffset))[0]; mOffset+=2; return res; };
    me.ReadUInt32 = function()  { var res = (new Uint32Array(mDataView,mOffset))[0]; mOffset+=4; return res; };
    me.ReadUInt64 = function()  { return me.ReadUInt32() + (me.ReadUInt32()<<32); };
    me.ReadFloat32 = function() { var res = (new Float32Array(mDataView,mOffset))[0]; mOffset+=4; return res; };
    me.ReadFloat32Array = function(n) 
                          { 
                              var src = new Float32Array(mDataView, mOffset);
                              var res = [];  for( var i=0; i<n; i++ ) { res[i] = src[i]; }
                              mOffset += 4*n;
                              return res;
                          };
    me.ReadFloat32ArrayNative = function(n) { var src = new Float32Array(mDataView, mOffset); mOffset += 4*n; return src; };
    return me;
}
//==============================================================================
//
// piLibs 2015-2017 - http://www.iquilezles.org/www/material/piLibs/piLibs.htm
//
// piMesh
//
//==============================================================================

function piMesh()
{
    this.mChunks = [];
    this.mPrimitiveType = 0;
    this.mVertexFormat = null;
}

/*
piMesh.prototype.normalize = function( ppos, npos )
{
    var numv = this.mVertexData.length;
    var numt = this.mIndices.length;

    for( var i=0; i<numv; i++ )
    {
        //float *v = (float*)piMesh_GetVertexData( me, i, npos );
        //v[0] = 0.0f;
        //v[1] = 0.0f;
        //v[2] = 0.0f;
        this.mVerts[8 * i + 3] = 0.0;
        this.mVerts[8 * i + 4] = 0.0;
        this.mVerts[8 * i + 5] = 0.0;
    }

    for( var i=0; i<numt; i++ )
    {
        piMeshFace *face = me->mFaceData.mIndexArray[0].mBuffer + i;

        const int ft = face->mNum;
        
        vec3 nor = vec3( 0.0f, 0.0f, 0.0f );
        for( int j=0; j<ft; j++ )
        {
            const vec3 va = *((vec3*)piMesh_GetVertexData( me, face->mIndex[ j      ], ppos ));
            const vec3 vb = *((vec3*)piMesh_GetVertexData( me, face->mIndex[(j+1)%ft], ppos ));

            nor += cross( va, vb );
        }

        for( int j=0; j<ft; j++ )
        {
            vec3 *n = (vec3*)piMesh_GetVertexData( me, face->mIndex[j], npos );
            n->x += nor.x;
            n->y += nor.y;
            n->z += nor.z;
        }
    }

    for( var i=0; i<numv; i++ )
    {
        vec3 *v = (vec3*)piMesh_GetVertexData( me, i, npos );
        *v = normalize( *v );
    }
}
*/

piMesh.prototype.createCube = function(renderer)
{
    this.mPrimitiveType = 0;

    this.mChunks[0] = { mVerts : new Float32Array([ -1.0, -1.0, -1.0,
                                       1.0, -1.0, -1.0,
                                      -1.0,  1.0, -1.0,
                                       1.0,  1.0, -1.0,
                                      -1.0, -1.0,  1.0,
                                       1.0, -1.0,  1.0,
                                      -1.0,  1.0,  1.0,
                                       1.0,  1.0,  1.0 ]),

                        mIndices : new Uint16Array([ 0, 2, 1,   1, 2, 3,   5, 1, 3,   5, 3, 7,   4, 5, 7,   4, 7, 6,   4, 6, 2,   4, 2, 0,   6, 7, 3,   6, 3, 2,   4, 0, 1,   4, 1, 5 ]),
                        mNumVertices : 8,
                        mNumFaces : 12, 
                        mTransform : setIdentity(),
                        mVBO : null, 
                        mIBO : null };

    this.mVertexFormat = { mStride:12, mChannels:[ { mNumComponents:3, mType: renderer.TYPE.FLOAT32, mNormalize: false } ] };

    return true;
}

piMesh.prototype.createCubeSharp = function (renderer)
{
    this.mPrimitiveType = 0;

    this.mChunks[0] = { mVerts : new Float32Array([-1.0, 1.0,-1.0,   0.0, 1.0, 0.0,   0.0, 0.0,
                                    -1.0, 1.0, 1.0,   0.0, 1.0, 0.0,   0.0, 1.0,
                                     1.0, 1.0, 1.0,   0.0, 1.0, 0.0,   1.0, 1.0,
                                     1.0, 1.0,-1.0,   0.0, 1.0, 0.0,   1.0, 0.0,

                                    -1.0,-1.0, 1.0,   0.0, 0.0, 1.0,   0.0, 0.0,
                                     1.0,-1.0, 1.0,   0.0, 0.0, 1.0,   0.0, 1.0,
                                     1.0, 1.0, 1.0,   0.0, 0.0, 1.0,   1.0, 1.0,
                                    -1.0, 1.0, 1.0,   0.0, 0.0, 1.0,   1.0, 0.0,

                                     1.0, 1.0, 1.0,   1.0, 0.0, 0.0,   0.0, 0.0,
                                     1.0,-1.0, 1.0,   1.0, 0.0, 0.0,   0.0, 1.0,
                                     1.0,-1.0,-1.0,   1.0, 0.0, 0.0,   1.0, 1.0,
                                     1.0, 1.0,-1.0,   1.0, 0.0, 0.0,   1.0, 0.0,

                                     1.0,-1.0,-1.0,   0.0, 0.0,-1.0,   0.0, 0.0,
                                    -1.0,-1.0,-1.0,   0.0, 0.0,-1.0,   0.0, 1.0,
                                    -1.0, 1.0,-1.0,   0.0, 0.0,-1.0,   1.0, 1.0,
                                     1.0, 1.0,-1.0,   0.0, 0.0,-1.0,   1.0, 0.0,

                                    -1.0,-1.0, 1.0,   0.0,-1.0, 0.0,   0.0, 0.0,
                                    -1.0,-1.0,-1.0,   0.0,-1.0, 0.0,   0.0, 1.0,
                                     1.0,-1.0,-1.0,   0.0,-1.0, 0.0,   1.0, 1.0,
                                     1.0,-1.0, 1.0,   0.0,-1.0, 0.0,   1.0, 0.0,

                                    -1.0, 1.0, 1.0,  -1.0, 0.0, 0.0,   0.0, 0.0,
                                    -1.0, 1.0,-1.0,  -1.0, 0.0, 0.0,   0.0, 1.0,
                                    -1.0,-1.0,-1.0,  -1.0, 0.0, 0.0,   1.0, 1.0,
                                    -1.0,-1.0, 1.0,  -1.0, 0.0, 0.0,   1.0, 0.0 ]),

                        mIndices : new Uint16Array([0,1,2, 0,2,3,   4,5,6, 4,6,7,    8,9,10,8,10,11,   12,13,14,12,14,15,   16,17,18,16,18,19,   20,21,22,20,22,23]),
                        mNumVertices : 24,
                        mNumFaces : 12, 
                        mTransform : setIdentity(),
                        mVBO : null, 
                        mIBO : null };


    this.mVertexFormat = { mStride:32, mChannels:[ { mNumComponents:3, mType: renderer.TYPE.FLOAT32, mNormalize: false },
                                                   { mNumComponents:3, mType: renderer.TYPE.FLOAT32, mNormalize: false },
                                                   { mNumComponents:2, mType: renderer.TYPE.FLOAT32, mNormalize: false } ] };

    return true;
}


piMesh.prototype.createUnitQuad = function (renderer)
{
    this.mPrimitiveType = 0;
    this.mVertexFormat = { mStride:8, mChannels: [ {mNumComponents:2, mType: renderer.TYPE.FLOAT32, mNormalize: false} ] };

    this.mChunks[0] = { mVerts : new Float32Array([-1.0, -1.0, 1.0, -1.0, -1.0,  1.0, 1.0,  1.0]),
                        mIndices : new Uint16Array([0, 2, 1, 1, 2, 3]),
                        mNumVertices : 4,
                        mNumFaces : 2, 
                        mTransform : setIdentity(),
                        mVBO : null, 
                        mIBO : null };
 
    return true;
}




piMesh.prototype.destroy = function()
{
    //delete this.mVerts;   this.mVerts = null;
    //delete this.mIndices; this.mIndices = null;
}

piMesh.prototype.scale = function (x, y, z)
{
    var stride = this.mVertexFormat.mStride/4;
    for( var j=0; j<this.mChunks.length; j++ )
    {
        var nv = this.mChunks[j].mNumVertices;
        for (var i = 0; i < nv; i++) 
        {
            this.mChunks[j].mVerts[stride * i + 0] *= x;
            this.mChunks[j].mVerts[stride * i + 1] *= y;
            this.mChunks[j].mVerts[stride * i + 2] *= z;
        }
    }
}

piMesh.prototype.translate = function (x, y, z) 
{
    var stride = this.mVertexFormat.mStride/4;
    for( var j=0; j<this.mChunks.length; j++ )
    {
        var nv = this.mChunks[j].mNumVertices;
        for (var i = 0; i < nv; i++) 
        {
            this.mChunks[j].mVerts[stride * i + 0] += x;
            this.mChunks[j].mVerts[stride * i + 1] += y;
            this.mChunks[j].mVerts[stride * i + 2] += z;
        }
    }
}

piMesh.prototype.GPULoad = function (renderer)
{
    for( var i=0; i<this.mChunks.length; i++ )
    {
        var vbo = renderer.CreateVertexArray(this.mChunks[i].mVerts, renderer.BUFTYPE.STATIC );
        if (vbo == null)
            return false;

        var ibo = renderer.CreateIndexArray(this.mChunks[i].mIndices, renderer.BUFTYPE.STATIC);
        if (ibo == null)
            return false;

        this.mChunks[i].mVBO = vbo;
        this.mChunks[i].mIBO = ibo;
    }
    return true;
}

piMesh.prototype.GPURender = function (renderer, positions )//, matPrj, matCam )
{
    //renderer.SetShaderConstantMat4F("unMPrj", matPrj, false );

    var num = this.mChunks.length;
    for( var i=0; i<num; i++ )
    {
        //var mat =  matMul( matCam, this.mChunks[i].mTransform );
        //renderer.SetShaderConstantMat4F("unMMod", mat, false);

        renderer.AttachVertexArray(this.mChunks[i].mVBO, this.mVertexFormat, positions );
        renderer.AttachIndexArray(this.mChunks[i].mIBO );
        renderer.DrawPrimitive(renderer.PRIMTYPE.TRIANGLES, this.mChunks[i].mNumFaces * 3, true, 1);
        renderer.DetachIndexArray(this.mChunks[i].mIBO);
        renderer.DetachVertexArray(this.mChunks[i].mVBO, this.mVertexFormat );
    }
}
//==============================================================================
//
// piLibs 2014-2017 - http://www.iquilezles.org/www/material/piLibs/piLibs.htm
//
// piRenderer
//
//==============================================================================

function piRenderer()
{
    // private members

    var mGL = null;
    var mBindedShader = null;
    var mIs20 = false;
    var mFloat32Textures;
    var mFloat32Filter;
    var mFloat16Textures;
    var mDrawBuffers;
    var mDepthTextures;
    var mDerivatives;
    var mFloat16Filter;
    var mShaderTextureLOD;
    var mAnisotropic;
    var mRenderToFloat32F;
    var mDebugShader;
    var mAsynchCompile;

    var mVBO_Quad = null;
    var mVBO_Tri = null;
    var mVBO_CubePosNor = null;
    var mVBO_CubePos = null;
    var mShaderHeader = ["",""];
    var mShaderHeaderLines = [0,0];

    // public members
    var me = {};

    me.CLEAR      = { Color: 1, Zbuffer : 2, Stencil : 4 };
    me.TEXFMT     = { C4I8 : 0, C1I8 : 1, C1F16 : 2, C4F16 : 3, C1F32 : 4, C4F32 : 5, Z16 : 6, Z24 : 7, Z32 : 8, C3F32:9 };
    me.TEXWRP     = { CLAMP : 0, REPEAT : 1 };
    me.BUFTYPE    = { STATIC : 0, DYNAMIC : 1 };
    me.PRIMTYPE   = { POINTS : 0, LINES : 1, LINE_LOOP : 2, LINE_STRIP : 3, TRIANGLES : 4, TRIANGLE_STRIP : 5 };
    me.RENDSTGATE = { WIREFRAME : 0, FRONT_FACE : 1, CULL_FACE : 2, DEPTH_TEST : 3, ALPHA_TO_COVERAGE : 4 };
    me.TEXTYPE    = { T2D : 0, T3D : 1, CUBEMAP : 2 };
    me.FILTER     = { NONE : 0, LINEAR : 1, MIPMAP : 2, NONE_MIPMAP : 3 };
    me.TYPE       = { UINT8 : 0, UINT16 : 1, UINT32 : 2, FLOAT16: 3, FLOAT32 : 4, FLOAT64: 5 };

    // private functions

    var iFormatPI2GL = function( format )
    {
        if( mIs20 )
        {
             if (format === me.TEXFMT.C4I8)  return { mGLFormat: mGL.RGBA8,           mGLExternal: mGL.RGBA,             mGLType: mGL.UNSIGNED_BYTE }
        else if (format === me.TEXFMT.C1I8)  return { mGLFormat: mGL.R8,              mGLExternal: mGL.RED,              mGLType: mGL.UNSIGNED_BYTE }
        else if (format === me.TEXFMT.C1F16) return { mGLFormat: mGL.R16F,            mGLExternal: mGL.RED,              mGLType: mGL.FLOAT }
        else if (format === me.TEXFMT.C4F16) return { mGLFormat: mGL.RGBA16F,         mGLExternal: mGL.RGBA,             mGLType: mGL.FLOAT }
        else if (format === me.TEXFMT.C1F32) return { mGLFormat: mGL.R32F,            mGLExternal: mGL.RED,              mGLType: mGL.FLOAT }
        else if (format === me.TEXFMT.C4F32) return { mGLFormat: mGL.RGBA32F,         mGLExternal: mGL.RGBA,             mGLType: mGL.FLOAT }
        else if (format === me.TEXFMT.C3F32) return { mGLFormat: mGL.RGB32F,          mGLExternal: mGL.RGB,              mGLType: mGL.FLOAT }
        else if (format === me.TEXFMT.Z16)   return { mGLFormat: mGL.DEPTH_COMPONENT16, mGLExternal: mGL.DEPTH_COMPONENT,  mGLType: mGL.UNSIGNED_SHORT }
        else if (format === me.TEXFMT.Z24)   return { mGLFormat: mGL.DEPTH_COMPONENT24, mGLExternal: mGL.DEPTH_COMPONENT,  mGLType: mGL.UNSIGNED_SHORT }
        else if (format === me.TEXFMT.Z32)   return { mGLFormat: mGL.DEPTH_COMPONENT32F, mGLExternal: mGL.DEPTH_COMPONENT,  mGLType: mGL.UNSIGNED_SHORT }
        }
        else
        {
             if (format === me.TEXFMT.C4I8)  return { mGLFormat: mGL.RGBA,            mGLExternal: mGL.RGBA,            mGLType: mGL.UNSIGNED_BYTE }
        else if (format === me.TEXFMT.C1I8)  return { mGLFormat: mGL.LUMINANCE,       mGLExternal: mGL.LUMINANCE,       mGLType: mGL.UNSIGNED_BYTE }
        else if (format === me.TEXFMT.C1F16) return { mGLFormat: mGL.LUMINANCE,       mGLExternal: mGL.LUMINANCE,       mGLType: mGL.FLOAT }
        else if (format === me.TEXFMT.C4F16) return { mGLFormat: mGL.RGBA,            mGLExternal: mGL.RGBA,            mGLType: mGL.FLOAT }
        else if (format === me.TEXFMT.C1F32) return { mGLFormat: mGL.LUMINANCE,       mGLExternal: mGL.RED,             mGLType: mGL.FLOAT }
        else if (format === me.TEXFMT.C4F32) return { mGLFormat: mGL.RGBA,            mGLExternal: mGL.RGBA,            mGLType: mGL.FLOAT }
        else if (format === me.TEXFMT.Z16)   return { mGLFormat: mGL.DEPTH_COMPONENT, mGLExternal: mGL.DEPTH_COMPONENT, mGLType: mGL.UNSIGNED_SHORT }
        }

        return null;
     }

    var ApplyDeviceFilteringLimits = function( filter, format )
    {
        if ((filter === me.FILTER.LINEAR || filter === me.FILTER.MIPMAP) && 
            mFloat32Filter === null && 
            (format == me.TEXFMT.C1F32 || format == me.TEXFMT.C4F32 || format == me.TEXFMT.C3F32)) 
        {
            filter = me.FILTER.NONE; 
        }
        return filter;
    }

    // public functions

    me.Initialize = function( gl )
                    {
                        mGL = gl;

                        mIs20 = !(gl instanceof WebGLRenderingContext);

                        if( mIs20 )
                        {
                            mFloat32Textures  = true;
                            mFloat32Filter    = mGL.getExtension( 'OES_texture_float_linear');
                            mFloat16Textures  = true; 
                            mFloat16Filter    = mGL.getExtension( 'OES_texture_half_float_linear' );
                            mDerivatives      = true;
                            mDrawBuffers      = true;
                            mDepthTextures    = true;
                            mShaderTextureLOD = true;
                            mAnisotropic = mGL.getExtension( 'EXT_texture_filter_anisotropic' );
                            mRenderToFloat32F = mGL.getExtension( 'EXT_color_buffer_float');
                            mDebugShader = mGL.getExtension('WEBGL_debug_shaders');
                            mAsynchCompile = mGL.getExtension('KHR_parallel_shader_compile');

							mGL.hint( mGL.FRAGMENT_SHADER_DERIVATIVE_HINT, mGL.NICEST);
                        }
                        else
                        {
                            mFloat32Textures  = mGL.getExtension( 'OES_texture_float' );
                            mFloat32Filter    = mGL.getExtension( 'OES_texture_float_linear');
                            mFloat16Textures  = mGL.getExtension( 'OES_texture_half_float' );
                            mFloat16Filter    = mGL.getExtension( 'OES_texture_half_float_linear' );
                            mDerivatives      = mGL.getExtension( 'OES_standard_derivatives' );
                            mDrawBuffers      = mGL.getExtension( 'WEBGL_draw_buffers' );
                            mDepthTextures    = mGL.getExtension( 'WEBGL_depth_texture' );
                            mShaderTextureLOD = mGL.getExtension( 'EXT_shader_texture_lod' );
                            mAnisotropic      = mGL.getExtension( 'EXT_texture_filter_anisotropic' );
                            mRenderToFloat32F = mFloat32Textures;
                            mDebugShader      = null;
                            mAsynchCompile    = null;
							
							if( mDerivatives !== null) mGL.hint( mDerivatives.FRAGMENT_SHADER_DERIVATIVE_HINT_OES, mGL.NICEST);
                        }
                        
                        
                        var maxTexSize = mGL.getParameter( mGL.MAX_TEXTURE_SIZE );
                        var maxCubeSize = mGL.getParameter( mGL.MAX_CUBE_MAP_TEXTURE_SIZE );
                        var maxRenderbufferSize = mGL.getParameter( mGL.MAX_RENDERBUFFER_SIZE );
                        var extensions = mGL.getSupportedExtensions();
                        var textureUnits = mGL.getParameter( mGL.MAX_TEXTURE_IMAGE_UNITS );
                        console.log("WebGL (2.0=" + mIs20 + "):" +
                                    " Asynch Compile: "  + ((mAsynchCompile !==null) ? "yes" : "no") +
                                    ", Textures: F32 ["   + ((mFloat32Textures !==null) ? "yes" : "no") +
                                    "], F32 Linear Filter ["   + ((mFloat32Filter !==null) ? "yes" : "no") +
                                    "], F16 ["   + ((mFloat16Textures !==null) ? "yes" : "no") +
                                    "], F16 Linear Filter ["   + ((mFloat16Filter !==null) ? "yes" : "no") +
                                    "], Depth [" + ((mDepthTextures   !==null) ? "yes" : "no") +
                                    "], LOD ["    + ((mShaderTextureLOD!==null) ? "yes" : "no") +
                                    "], Aniso ["   + ((mAnisotropic     !==null) ? "yes" : "no") +
                                    "], Units [" + textureUnits +
                                    "], Max Size [" + maxTexSize +
                                    "], Cube Max Size [" + maxCubeSize +
                                    "], Targets: MRT ["            + ((mDrawBuffers     !==null) ? "yes" : "no") +
                                    "], F32 ["     + ((mRenderToFloat32F!==null) ? "yes" : "no") +
                                    "], Max Size [" + maxRenderbufferSize + "]"
                                );

                        // create a 2D quad Vertex Buffer
                        var vertices = new Float32Array( [ -1.0, -1.0,   1.0, -1.0,    -1.0,  1.0,     1.0, -1.0,    1.0,  1.0,    -1.0,  1.0] );
                        mVBO_Quad = mGL.createBuffer();
                        mGL.bindBuffer( mGL.ARRAY_BUFFER, mVBO_Quad );
                        mGL.bufferData( mGL.ARRAY_BUFFER, vertices, mGL.STATIC_DRAW );
                        mGL.bindBuffer( mGL.ARRAY_BUFFER, null );

                        // create a 2D triangle Vertex Buffer
                        mVBO_Tri = mGL.createBuffer();
                        mGL.bindBuffer( mGL.ARRAY_BUFFER, mVBO_Tri );
                        mGL.bufferData( mGL.ARRAY_BUFFER, new Float32Array( [ -1.0, -1.0,   3.0, -1.0,    -1.0,  3.0] ), mGL.STATIC_DRAW );
                        mGL.bindBuffer( mGL.ARRAY_BUFFER, null );

                        // create a 3D cube Vertex Buffer
                        mVBO_CubePosNor = mGL.createBuffer();
                        mGL.bindBuffer( mGL.ARRAY_BUFFER, mVBO_CubePosNor );
                        mGL.bufferData( mGL.ARRAY_BUFFER, new Float32Array( [ -1.0, -1.0, -1.0,  -1.0,  0.0,  0.0,
                                                                              -1.0, -1.0,  1.0,  -1.0,  0.0,  0.0,
                                                                              -1.0,  1.0, -1.0,  -1.0,  0.0,  0.0,
                                                                              -1.0,  1.0,  1.0,  -1.0,  0.0,  0.0,
                                                                               1.0,  1.0, -1.0,   1.0,  0.0,  0.0,
                                                                               1.0,  1.0,  1.0,   1.0,  0.0,  0.0,
                                                                               1.0, -1.0, -1.0,   1.0,  0.0,  0.0,
                                                                               1.0, -1.0,  1.0,   1.0,  0.0,  0.0,
                                                                               1.0,  1.0,  1.0,   0.0,  1.0,  0.0,
                                                                               1.0,  1.0, -1.0,   0.0,  1.0,  0.0,
                                                                              -1.0,  1.0,  1.0,   0.0,  1.0,  0.0,
                                                                              -1.0,  1.0, -1.0,   0.0,  1.0,  0.0,
                                                                               1.0, -1.0, -1.0,   0.0, -1.0,  0.0,
                                                                               1.0, -1.0,  1.0,   0.0, -1.0,  0.0,
                                                                              -1.0, -1.0, -1.0,   0.0, -1.0,  0.0,
                                                                              -1.0, -1.0,  1.0,   0.0, -1.0,  0.0,
                                                                              -1.0,  1.0,  1.0,   0.0,  0.0,  1.0,
                                                                              -1.0, -1.0,  1.0,   0.0,  0.0,  1.0,
                                                                               1.0,  1.0,  1.0,   0.0,  0.0,  1.0,
                                                                               1.0, -1.0,  1.0,   0.0,  0.0,  1.0,
                                                                              -1.0, -1.0, -1.0,   0.0,  0.0, -1.0,
                                                                              -1.0,  1.0, -1.0,   0.0,  0.0, -1.0,
                                                                               1.0, -1.0, -1.0,   0.0,  0.0, -1.0,
                                                                               1.0,  1.0, -1.0,   0.0,  0.0, -1.0 ] ), mGL.STATIC_DRAW );
                        mGL.bindBuffer( mGL.ARRAY_BUFFER, null );

                        // create a 3D cube Vertex Buffer
                        mVBO_CubePos = mGL.createBuffer();
                        mGL.bindBuffer( mGL.ARRAY_BUFFER, mVBO_CubePos );
                        mGL.bufferData( mGL.ARRAY_BUFFER, new Float32Array( [ -1.0, -1.0, -1.0,
                                                                              -1.0, -1.0,  1.0,
                                                                              -1.0,  1.0, -1.0,
                                                                              -1.0,  1.0,  1.0,
                                                                               1.0,  1.0, -1.0,
                                                                               1.0,  1.0,  1.0,
                                                                               1.0, -1.0, -1.0,
                                                                               1.0, -1.0,  1.0,
                                                                               1.0,  1.0,  1.0,
                                                                               1.0,  1.0, -1.0,
                                                                              -1.0,  1.0,  1.0,
                                                                              -1.0,  1.0, -1.0,
                                                                               1.0, -1.0, -1.0,
                                                                               1.0, -1.0,  1.0,
                                                                              -1.0, -1.0, -1.0,
                                                                              -1.0, -1.0,  1.0,
                                                                              -1.0,  1.0,  1.0,
                                                                              -1.0, -1.0,  1.0,
                                                                               1.0,  1.0,  1.0,
                                                                               1.0, -1.0,  1.0,
                                                                              -1.0, -1.0, -1.0,
                                                                              -1.0,  1.0, -1.0,
                                                                               1.0, -1.0, -1.0,
                                                                               1.0,  1.0, -1.0 ] ), mGL.STATIC_DRAW );
                        mGL.bindBuffer( mGL.ARRAY_BUFFER, null );

                        //-------------------------------------------------------------------

                        mShaderHeader[0] = "";
                        mShaderHeaderLines[0] = 0;
                        if( mIs20 ) 
                        { 
                            mShaderHeader[0] += "#version 300 es\n" +
                                                "#ifdef GL_ES\n"+
                                                "precision highp float;\n" +
                                                "precision highp int;\n"+
                                                "precision mediump sampler3D;\n"+
                                                "#endif\n"; 
                            mShaderHeaderLines[0] += 6;
                        }
                        else
                        {
                            mShaderHeader[0] += "#ifdef GL_ES\n"+
                                                "precision highp float;\n" +
                                                "precision highp int;\n"+
                                                "#endif\n"+
                                                "float round( float x ) { return floor(x+0.5); }\n"+
                                                "vec2 round(vec2 x) { return floor(x + 0.5); }\n"+
                                                "vec3 round(vec3 x) { return floor(x + 0.5); }\n"+
                                                "vec4 round(vec4 x) { return floor(x + 0.5); }\n"+
                                                "float trunc( float x, float n ) { return floor(x*n)/n; }\n"+
                                                "mat3 transpose(mat3 m) { return mat3(m[0].x, m[1].x, m[2].x, m[0].y, m[1].y, m[2].y, m[0].z, m[1].z, m[2].z); }\n"+
                                                "float determinant( in mat2 m ) { return m[0][0]*m[1][1] - m[0][1]*m[1][0]; }\n"+
                                                "float determinant( mat4 m ) { float b00 = m[0][0] * m[1][1] - m[0][1] * m[1][0], b01 = m[0][0] * m[1][2] - m[0][2] * m[1][0], b02 = m[0][0] * m[1][3] - m[0][3] * m[1][0], b03 = m[0][1] * m[1][2] - m[0][2] * m[1][1], b04 = m[0][1] * m[1][3] - m[0][3] * m[1][1], b05 = m[0][2] * m[1][3] - m[0][3] * m[1][2], b06 = m[2][0] * m[3][1] - m[2][1] * m[3][0], b07 = m[2][0] * m[3][2] - m[2][2] * m[3][0], b08 = m[2][0] * m[3][3] - m[2][3] * m[3][0], b09 = m[2][1] * m[3][2] - m[2][2] * m[3][1], b10 = m[2][1] * m[3][3] - m[2][3] * m[3][1], b11 = m[2][2] * m[3][3] - m[2][3] * m[3][2];  return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;}\n"+
                                                "mat2 inverse(mat2 m) { float det = determinant(m); return mat2(m[1][1], -m[0][1], -m[1][0], m[0][0]) / det; }\n"+
                                                "mat4 inverse(mat4 m ) { float inv0 = m[1].y*m[2].z*m[3].w - m[1].y*m[2].w*m[3].z - m[2].y*m[1].z*m[3].w + m[2].y*m[1].w*m[3].z + m[3].y*m[1].z*m[2].w - m[3].y*m[1].w*m[2].z; float inv4 = -m[1].x*m[2].z*m[3].w + m[1].x*m[2].w*m[3].z + m[2].x*m[1].z*m[3].w - m[2].x*m[1].w*m[3].z - m[3].x*m[1].z*m[2].w + m[3].x*m[1].w*m[2].z; float inv8 = m[1].x*m[2].y*m[3].w - m[1].x*m[2].w*m[3].y - m[2].x  * m[1].y * m[3].w + m[2].x  * m[1].w * m[3].y + m[3].x * m[1].y * m[2].w - m[3].x * m[1].w * m[2].y; float inv12 = -m[1].x  * m[2].y * m[3].z + m[1].x  * m[2].z * m[3].y +m[2].x  * m[1].y * m[3].z - m[2].x  * m[1].z * m[3].y - m[3].x * m[1].y * m[2].z + m[3].x * m[1].z * m[2].y; float inv1 = -m[0].y*m[2].z * m[3].w + m[0].y*m[2].w * m[3].z + m[2].y  * m[0].z * m[3].w - m[2].y  * m[0].w * m[3].z - m[3].y * m[0].z * m[2].w + m[3].y * m[0].w * m[2].z; float inv5 = m[0].x  * m[2].z * m[3].w - m[0].x  * m[2].w * m[3].z - m[2].x  * m[0].z * m[3].w + m[2].x  * m[0].w * m[3].z + m[3].x * m[0].z * m[2].w - m[3].x * m[0].w * m[2].z; float inv9 = -m[0].x  * m[2].y * m[3].w +  m[0].x  * m[2].w * m[3].y + m[2].x  * m[0].y * m[3].w - m[2].x  * m[0].w * m[3].y - m[3].x * m[0].y * m[2].w + m[3].x * m[0].w * m[2].y; float inv13 = m[0].x  * m[2].y * m[3].z - m[0].x  * m[2].z * m[3].y - m[2].x  * m[0].y * m[3].z + m[2].x  * m[0].z * m[3].y + m[3].x * m[0].y * m[2].z - m[3].x * m[0].z * m[2].y; float inv2 = m[0].y  * m[1].z * m[3].w - m[0].y  * m[1].w * m[3].z - m[1].y  * m[0].z * m[3].w + m[1].y  * m[0].w * m[3].z + m[3].y * m[0].z * m[1].w - m[3].y * m[0].w * m[1].z; float inv6 = -m[0].x  * m[1].z * m[3].w + m[0].x  * m[1].w * m[3].z + m[1].x  * m[0].z * m[3].w - m[1].x  * m[0].w * m[3].z - m[3].x * m[0].z * m[1].w + m[3].x * m[0].w * m[1].z; float inv10 = m[0].x  * m[1].y * m[3].w - m[0].x  * m[1].w * m[3].y - m[1].x  * m[0].y * m[3].w + m[1].x  * m[0].w * m[3].y + m[3].x * m[0].y * m[1].w - m[3].x * m[0].w * m[1].y; float inv14 = -m[0].x  * m[1].y * m[3].z + m[0].x  * m[1].z * m[3].y + m[1].x  * m[0].y * m[3].z - m[1].x  * m[0].z * m[3].y - m[3].x * m[0].y * m[1].z + m[3].x * m[0].z * m[1].y; float inv3 = -m[0].y * m[1].z * m[2].w + m[0].y * m[1].w * m[2].z + m[1].y * m[0].z * m[2].w - m[1].y * m[0].w * m[2].z - m[2].y * m[0].z * m[1].w + m[2].y * m[0].w * m[1].z; float inv7 = m[0].x * m[1].z * m[2].w - m[0].x * m[1].w * m[2].z - m[1].x * m[0].z * m[2].w + m[1].x * m[0].w * m[2].z + m[2].x * m[0].z * m[1].w - m[2].x * m[0].w * m[1].z; float inv11 = -m[0].x * m[1].y * m[2].w + m[0].x * m[1].w * m[2].y + m[1].x * m[0].y * m[2].w - m[1].x * m[0].w * m[2].y - m[2].x * m[0].y * m[1].w + m[2].x * m[0].w * m[1].y; float inv15 = m[0].x * m[1].y * m[2].z - m[0].x * m[1].z * m[2].y - m[1].x * m[0].y * m[2].z + m[1].x * m[0].z * m[2].y + m[2].x * m[0].y * m[1].z - m[2].x * m[0].z * m[1].y; float det = m[0].x * inv0 + m[0].y * inv4 + m[0].z * inv8 + m[0].w * inv12; det = 1.0 / det; return det*mat4( inv0, inv1, inv2, inv3,inv4, inv5, inv6, inv7,inv8, inv9, inv10, inv11,inv12, inv13, inv14, inv15);}\n"+                                                
                                                "float sinh(float x)  { return (exp(x)-exp(-x))/2.; }\n"+
                                                "float cosh(float x)  { return (exp(x)+exp(-x))/2.; }\n"+
                                                "float tanh(float x)  { return sinh(x)/cosh(x); }\n"+
                                                "float coth(float x)  { return cosh(x)/sinh(x); }\n"+
                                                "float sech(float x)  { return 1./cosh(x); }\n"+
                                                "float csch(float x)  { return 1./sinh(x); }\n"+
                                                "float asinh(float x) { return    log(x+sqrt(x*x+1.)); }\n"+
                                                "float acosh(float x) { return    log(x+sqrt(x*x-1.)); }\n"+
                                                "float atanh(float x) { return .5*log((1.+x)/(1.-x)); }\n"+
                                                "float acoth(float x) { return .5*log((x+1.)/(x-1.)); }\n"+
                                                "float asech(float x) { return    log((1.+sqrt(1.-x*x))/x); }\n"+
                                                "float acsch(float x) { return    log((1.+sqrt(1.+x*x))/x); }\n";
                            mShaderHeaderLines[0] += 26;
                        }

                        //-------------------------------------------------------

                        mShaderHeader[1] = "";
                        mShaderHeaderLines[1] = 0;
                        if( mIs20 ) 
                        { 
                            mShaderHeader[1] += "#version 300 es\n"+
                                                "#ifdef GL_ES\n"+
                                                "precision highp float;\n"+
                                                "precision highp int;\n"+
                                                "precision mediump sampler3D;\n"+
                                                "#endif\n"; 
                            mShaderHeaderLines[1] += 6;
                        }
                        else
                        {
                            if( mDerivatives ) { mShaderHeader[1] += "#ifdef GL_OES_standard_derivatives\n#extension GL_OES_standard_derivatives : enable\n#endif\n"; mShaderHeaderLines[1]+=3; }
                            if( mShaderTextureLOD  ) { mShaderHeader[1] += "#extension GL_EXT_shader_texture_lod : enable\n"; mShaderHeaderLines[1]++; }
                            mShaderHeader[1] += "#ifdef GL_ES\n"+
                                                "precision highp float;\n"+
                                                "precision highp int;\n"+
                                                "#endif\n"+ 
                                                "vec4 texture(     sampler2D   s, vec2 c)                   { return texture2D(s,c); }\n"+
                                                "vec4 texture(     sampler2D   s, vec2 c, float b)          { return texture2D(s,c,b); }\n"+
                                                "vec4 texture(     samplerCube s, vec3 c )                  { return textureCube(s,c); }\n"+
                                                "vec4 texture(     samplerCube s, vec3 c, float b)          { return textureCube(s,c,b); }\n"+
                                                "float round( float x ) { return floor(x+0.5); }\n"+
                                                "vec2 round(vec2 x) { return floor(x + 0.5); }\n"+
                                                "vec3 round(vec3 x) { return floor(x + 0.5); }\n"+
                                                "vec4 round(vec4 x) { return floor(x + 0.5); }\n"+
                                                "float trunc( float x, float n ) { return floor(x*n)/n; }\n"+
                                                "mat3 transpose(mat3 m) { return mat3(m[0].x, m[1].x, m[2].x, m[0].y, m[1].y, m[2].y, m[0].z, m[1].z, m[2].z); }\n"+
                                                "float determinant( in mat2 m ) { return m[0][0]*m[1][1] - m[0][1]*m[1][0]; }\n"+
                                                "float determinant( mat4 m ) { float b00 = m[0][0] * m[1][1] - m[0][1] * m[1][0], b01 = m[0][0] * m[1][2] - m[0][2] * m[1][0], b02 = m[0][0] * m[1][3] - m[0][3] * m[1][0], b03 = m[0][1] * m[1][2] - m[0][2] * m[1][1], b04 = m[0][1] * m[1][3] - m[0][3] * m[1][1], b05 = m[0][2] * m[1][3] - m[0][3] * m[1][2], b06 = m[2][0] * m[3][1] - m[2][1] * m[3][0], b07 = m[2][0] * m[3][2] - m[2][2] * m[3][0], b08 = m[2][0] * m[3][3] - m[2][3] * m[3][0], b09 = m[2][1] * m[3][2] - m[2][2] * m[3][1], b10 = m[2][1] * m[3][3] - m[2][3] * m[3][1], b11 = m[2][2] * m[3][3] - m[2][3] * m[3][2];  return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;}\n"+
                                                "mat2 inverse(mat2 m) { float det = determinant(m); return mat2(m[1][1], -m[0][1], -m[1][0], m[0][0]) / det; }\n"+
                                                "mat4 inverse(mat4 m ) { float inv0 = m[1].y*m[2].z*m[3].w - m[1].y*m[2].w*m[3].z - m[2].y*m[1].z*m[3].w + m[2].y*m[1].w*m[3].z + m[3].y*m[1].z*m[2].w - m[3].y*m[1].w*m[2].z; float inv4 = -m[1].x*m[2].z*m[3].w + m[1].x*m[2].w*m[3].z + m[2].x*m[1].z*m[3].w - m[2].x*m[1].w*m[3].z - m[3].x*m[1].z*m[2].w + m[3].x*m[1].w*m[2].z; float inv8 = m[1].x*m[2].y*m[3].w - m[1].x*m[2].w*m[3].y - m[2].x  * m[1].y * m[3].w + m[2].x  * m[1].w * m[3].y + m[3].x * m[1].y * m[2].w - m[3].x * m[1].w * m[2].y; float inv12 = -m[1].x  * m[2].y * m[3].z + m[1].x  * m[2].z * m[3].y +m[2].x  * m[1].y * m[3].z - m[2].x  * m[1].z * m[3].y - m[3].x * m[1].y * m[2].z + m[3].x * m[1].z * m[2].y; float inv1 = -m[0].y*m[2].z * m[3].w + m[0].y*m[2].w * m[3].z + m[2].y  * m[0].z * m[3].w - m[2].y  * m[0].w * m[3].z - m[3].y * m[0].z * m[2].w + m[3].y * m[0].w * m[2].z; float inv5 = m[0].x  * m[2].z * m[3].w - m[0].x  * m[2].w * m[3].z - m[2].x  * m[0].z * m[3].w + m[2].x  * m[0].w * m[3].z + m[3].x * m[0].z * m[2].w - m[3].x * m[0].w * m[2].z; float inv9 = -m[0].x  * m[2].y * m[3].w +  m[0].x  * m[2].w * m[3].y + m[2].x  * m[0].y * m[3].w - m[2].x  * m[0].w * m[3].y - m[3].x * m[0].y * m[2].w + m[3].x * m[0].w * m[2].y; float inv13 = m[0].x  * m[2].y * m[3].z - m[0].x  * m[2].z * m[3].y - m[2].x  * m[0].y * m[3].z + m[2].x  * m[0].z * m[3].y + m[3].x * m[0].y * m[2].z - m[3].x * m[0].z * m[2].y; float inv2 = m[0].y  * m[1].z * m[3].w - m[0].y  * m[1].w * m[3].z - m[1].y  * m[0].z * m[3].w + m[1].y  * m[0].w * m[3].z + m[3].y * m[0].z * m[1].w - m[3].y * m[0].w * m[1].z; float inv6 = -m[0].x  * m[1].z * m[3].w + m[0].x  * m[1].w * m[3].z + m[1].x  * m[0].z * m[3].w - m[1].x  * m[0].w * m[3].z - m[3].x * m[0].z * m[1].w + m[3].x * m[0].w * m[1].z; float inv10 = m[0].x  * m[1].y * m[3].w - m[0].x  * m[1].w * m[3].y - m[1].x  * m[0].y * m[3].w + m[1].x  * m[0].w * m[3].y + m[3].x * m[0].y * m[1].w - m[3].x * m[0].w * m[1].y; float inv14 = -m[0].x  * m[1].y * m[3].z + m[0].x  * m[1].z * m[3].y + m[1].x  * m[0].y * m[3].z - m[1].x  * m[0].z * m[3].y - m[3].x * m[0].y * m[1].z + m[3].x * m[0].z * m[1].y; float inv3 = -m[0].y * m[1].z * m[2].w + m[0].y * m[1].w * m[2].z + m[1].y * m[0].z * m[2].w - m[1].y * m[0].w * m[2].z - m[2].y * m[0].z * m[1].w + m[2].y * m[0].w * m[1].z; float inv7 = m[0].x * m[1].z * m[2].w - m[0].x * m[1].w * m[2].z - m[1].x * m[0].z * m[2].w + m[1].x * m[0].w * m[2].z + m[2].x * m[0].z * m[1].w - m[2].x * m[0].w * m[1].z; float inv11 = -m[0].x * m[1].y * m[2].w + m[0].x * m[1].w * m[2].y + m[1].x * m[0].y * m[2].w - m[1].x * m[0].w * m[2].y - m[2].x * m[0].y * m[1].w + m[2].x * m[0].w * m[1].y; float inv15 = m[0].x * m[1].y * m[2].z - m[0].x * m[1].z * m[2].y - m[1].x * m[0].y * m[2].z + m[1].x * m[0].z * m[2].y + m[2].x * m[0].y * m[1].z - m[2].x * m[0].z * m[1].y; float det = m[0].x * inv0 + m[0].y * inv4 + m[0].z * inv8 + m[0].w * inv12; det = 1.0 / det; return det*mat4( inv0, inv1, inv2, inv3,inv4, inv5, inv6, inv7,inv8, inv9, inv10, inv11,inv12, inv13, inv14, inv15);}\n"+
                                                "float sinh(float x)  { return (exp(x)-exp(-x))/2.; }\n"+
                                                "float cosh(float x)  { return (exp(x)+exp(-x))/2.; }\n"+
                                                "float tanh(float x)  { return sinh(x)/cosh(x); }\n"+
                                                "float coth(float x)  { return cosh(x)/sinh(x); }\n"+
                                                "float sech(float x)  { return 1./cosh(x); }\n"+
                                                "float csch(float x)  { return 1./sinh(x); }\n"+
                                                "float asinh(float x) { return    log(x+sqrt(x*x+1.)); }\n"+
                                                "float acosh(float x) { return    log(x+sqrt(x*x-1.)); }\n"+
                                                "float atanh(float x) { return .5*log((1.+x)/(1.-x)); }\n"+
                                                "float acoth(float x) { return .5*log((x+1.)/(x-1.)); }\n"+
                                                "float asech(float x) { return    log((1.+sqrt(1.-x*x))/x); }\n"+
                                                "float acsch(float x) { return    log((1.+sqrt(1.+x*x))/x); }\n";
                            mShaderHeaderLines[1] += 30;
                            if( mShaderTextureLOD )
                            {
                            mShaderHeader[1] += "vec4 textureLod(  sampler2D   s, vec2 c, float b)          { return texture2DLodEXT(s,c,b); }\n";
                            mShaderHeader[1] += "vec4 textureGrad( sampler2D   s, vec2 c, vec2 dx, vec2 dy) { return texture2DGradEXT(s,c,dx,dy); }\n";
                            mShaderHeaderLines[1] += 2;

                            //mShaderHeader[1] += "vec4 texelFetch( sampler2D s, ivec2 c, int l) { return texture2DLodEXT(s,(vec2(c)+0.5)/vec2(800,450),float(l)); }\n";
                            //mShaderHeaderLines[1] += 1;
                            }
                        }

                        return true;
                    };

        me.GetCaps =    function ()
                        {   
                            return { mIsGL20 : mIs20,
                                     mFloat32Textures: mFloat32Textures != null,
                                     mFloat16Textures: mFloat16Textures != null,
                                     mDrawBuffers: mDrawBuffers != null,
                                     mDepthTextures: mDepthTextures != null,
                                     mDerivatives: mDerivatives != null,
                                     mShaderTextureLOD: mShaderTextureLOD != null };
                        };

        me.GetShaderHeaderLines = function (shaderType)
                        {   
                            return mShaderHeaderLines[shaderType];
                        };

        me.CheckErrors = function()
                         {
                                var error = mGL.getError();
                                if( error != mGL.NO_ERROR ) 
                                { 
                                    for( var prop in mGL ) 
                                    {
                                        if( typeof mGL[prop] == 'number' ) 
                                        {
                                            if( mGL[prop] == error )
                                            {
                                                console.log( "GL Error " + error + ": " + prop );
                                                break;
                                            }
                                        }
                                    }
                                }
                         };

        me.Clear =  function( flags, ccolor, cdepth, cstencil )
                    {
                        var mode = 0;
                        if( flags & 1 ) { mode |= mGL.COLOR_BUFFER_BIT;   mGL.clearColor( ccolor[0], ccolor[1], ccolor[2], ccolor[3] ); }
                        if( flags & 2 ) { mode |= mGL.DEPTH_BUFFER_BIT;   mGL.clearDepth( cdepth ); }
                        if( flags & 4 ) { mode |= mGL.STENCIL_BUFFER_BIT; mGL.clearStencil( cstencil ); }
                        mGL.clear( mode );
                    };


        me.CreateTexture = function ( type, xres, yres, format, filter, wrap, buffer)
                           {
                                if( mGL===null ) return null;

                                var id = mGL.createTexture();

                                var glFoTy = iFormatPI2GL( format );
                                var glWrap = mGL.REPEAT; if (wrap === me.TEXWRP.CLAMP) glWrap = mGL.CLAMP_TO_EDGE;

                                filter = ApplyDeviceFilteringLimits(filter, format); 

                                if( type===me.TEXTYPE.T2D )
                                {
                                    mGL.bindTexture( mGL.TEXTURE_2D, id );
//if( buffer==null )
    //mGL.texStorage2D(mGL.TEXTURE_2D, 0, glFoTy.mGLFormat, xres, yres);
//else
                                    mGL.texImage2D( mGL.TEXTURE_2D, 0, glFoTy.mGLFormat, xres, yres, 0, glFoTy.mGLExternal, glFoTy.mGLType, buffer );
                                    mGL.texParameteri( mGL.TEXTURE_2D, mGL.TEXTURE_WRAP_S, glWrap );
                                    mGL.texParameteri( mGL.TEXTURE_2D, mGL.TEXTURE_WRAP_T, glWrap );

                                    if (filter === me.FILTER.NONE)
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MAG_FILTER, mGL.NEAREST);
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MIN_FILTER, mGL.NEAREST);
                                    }
                                    else if (filter === me.FILTER.LINEAR)
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR);
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MIN_FILTER, mGL.LINEAR);
                                    }
                                    else if (filter === me.FILTER.MIPMAP)
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR);
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MIN_FILTER, mGL.LINEAR_MIPMAP_LINEAR);
                                        mGL.generateMipmap(mGL.TEXTURE_2D);
                                    }
                                    else
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MAG_FILTER, mGL.NEAREST);
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MIN_FILTER, mGL.NEAREST_MIPMAP_LINEAR);
                                        mGL.generateMipmap(mGL.TEXTURE_2D);
                                    }

                                    mGL.bindTexture( mGL.TEXTURE_2D, null );
                                }
                                else if( type===me.TEXTYPE.T3D )
                                {
                                    if( mIs20 )
                                    {
                                        mGL.bindTexture( mGL.TEXTURE_3D, id );
                                        mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_BASE_LEVEL, 0);
                                        mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MAX_LEVEL, Math.log2(xres));
                                        if (filter === me.FILTER.NONE)
                                        {
                                            mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MAG_FILTER, mGL.NEAREST);
                                            mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MIN_FILTER, mGL.NEAREST);
                                        }
                                        else if (filter === me.FILTER.LINEAR)
                                        {
                                            mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR);
                                            mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MIN_FILTER, mGL.LINEAR);
                                        }
                                        else if (filter === me.FILTER.MIPMAP)
                                        {
                                            mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR);
                                            mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MIN_FILTER, mGL.LINEAR_MIPMAP_LINEAR);
                                        }
                                        else
                                        {
                                            mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MAG_FILTER, mGL.NEAREST);
                                            mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MIN_FILTER, mGL.NEAREST_MIPMAP_LINEAR);
                                            mGL.generateMipmap(mGL.TEXTURE_3D);
                                        }
                                        mGL.texImage3D( mGL.TEXTURE_3D, 0, glFoTy.mGLFormat, xres, yres, yres, 0, glFoTy.mGLExternal, glFoTy.mGLType, buffer );

                                        mGL.texParameteri( mGL.TEXTURE_3D, mGL.TEXTURE_WRAP_R, glWrap );
                                        mGL.texParameteri( mGL.TEXTURE_3D, mGL.TEXTURE_WRAP_S, glWrap );
                                        mGL.texParameteri( mGL.TEXTURE_3D, mGL.TEXTURE_WRAP_T, glWrap );

                                        if (filter === me.FILTER.MIPMAP)
                                            mGL.generateMipmap( mGL.TEXTURE_3D );
                                        mGL.bindTexture( mGL.TEXTURE_3D, null );
                                    }
                                    else 
                                    {
                                        return null;
                                    }
                                }
                                else 
                                {
                                    mGL.bindTexture( mGL.TEXTURE_CUBE_MAP, id );

                                    // this works great if we know the number of required mipmaps in advance (1, or other)
                                   //mGL.texStorage2D( mGL.TEXTURE_CUBE_MAP, 1, glFoTy.mGLFormat, xres, yres );

                                    mGL.texImage2D( mGL.TEXTURE_CUBE_MAP_POSITIVE_X, 0, glFoTy.mGLFormat, xres, yres, 0, glFoTy.mGLExternal, glFoTy.mGLType, buffer );
                                    mGL.texImage2D( mGL.TEXTURE_CUBE_MAP_NEGATIVE_X, 0, glFoTy.mGLFormat, xres, yres, 0, glFoTy.mGLExternal, glFoTy.mGLType, buffer );
                                    mGL.texImage2D( mGL.TEXTURE_CUBE_MAP_POSITIVE_Y, 0, glFoTy.mGLFormat, xres, yres, 0, glFoTy.mGLExternal, glFoTy.mGLType, buffer );
                                    mGL.texImage2D( mGL.TEXTURE_CUBE_MAP_NEGATIVE_Y, 0, glFoTy.mGLFormat, xres, yres, 0, glFoTy.mGLExternal, glFoTy.mGLType, buffer );
                                    mGL.texImage2D( mGL.TEXTURE_CUBE_MAP_POSITIVE_Z, 0, glFoTy.mGLFormat, xres, yres, 0, glFoTy.mGLExternal, glFoTy.mGLType, buffer );
                                    mGL.texImage2D( mGL.TEXTURE_CUBE_MAP_NEGATIVE_Z, 0, glFoTy.mGLFormat, xres, yres, 0, glFoTy.mGLExternal, glFoTy.mGLType, buffer );

                                    if( filter === me.FILTER.NONE)
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MAG_FILTER, mGL.NEAREST);
                                        mGL.texParameteri(mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MIN_FILTER, mGL.NEAREST);
                                    }
                                    else if (filter === me.FILTER.LINEAR)
                                    {
                                        mGL.texParameteri( mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR );
                                        mGL.texParameteri( mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MIN_FILTER, mGL.LINEAR );
                                    }
                                    else if (filter === me.FILTER.MIPMAP)
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR);
                                        mGL.texParameteri(mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MIN_FILTER, mGL.LINEAR_MIPMAP_LINEAR);
                                    }

                                    if (filter === me.FILTER.MIPMAP)
                                        mGL.generateMipmap( mGL.TEXTURE_CUBE_MAP );

                                    mGL.bindTexture( mGL.TEXTURE_CUBE_MAP, null );
                                }
                        return { mObjectID: id, mXres: xres, mYres: yres, mFormat: format, mType: type, mFilter: filter, mWrap: wrap, mVFlip:false };
                        };

        me.CreateTextureFromImage = function ( type, image, format, filter, wrap, flipY) 
                                {
                                    if( mGL===null ) return null;

                                    var id = mGL.createTexture();

                                    var glFoTy = iFormatPI2GL( format );

                                    filter = ApplyDeviceFilteringLimits(filter, format);

                                    var glWrap = mGL.REPEAT; if (wrap === me.TEXWRP.CLAMP) glWrap = mGL.CLAMP_TO_EDGE;

                                    if( type===me.TEXTYPE.T2D )
                                    {
                                        mGL.bindTexture(mGL.TEXTURE_2D, id);

                                        mGL.pixelStorei(mGL.UNPACK_FLIP_Y_WEBGL, flipY);
                                        mGL.pixelStorei(mGL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                                        if( mIs20 ) mGL.pixelStorei(mGL.UNPACK_COLORSPACE_CONVERSION_WEBGL, mGL.NONE );

                                        mGL.texImage2D(mGL.TEXTURE_2D, 0, glFoTy.mGLFormat, glFoTy.mGLExternal, glFoTy.mGLType, image);

                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_WRAP_S, glWrap);
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_WRAP_T, glWrap);

                                        if (filter === me.FILTER.NONE)
                                        {
                                            mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MAG_FILTER, mGL.NEAREST);
                                            mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MIN_FILTER, mGL.NEAREST);
                                        }
                                        else if (filter === me.FILTER.LINEAR)
                                        {
                                            mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR);
                                            mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MIN_FILTER, mGL.LINEAR);
                                        }
                                        else if( filter === me.FILTER.MIPMAP)
                                        {
                                            mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR);
                                            mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MIN_FILTER, mGL.LINEAR_MIPMAP_LINEAR);
                                            mGL.generateMipmap(mGL.TEXTURE_2D);
                                        }
                                        else
                                        {
                                            mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR);
                                            mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MIN_FILTER, mGL.NEAREST_MIPMAP_LINEAR);
                                            mGL.generateMipmap(mGL.TEXTURE_2D);
                                        }
                                        mGL.pixelStorei(mGL.UNPACK_FLIP_Y_WEBGL, false);
                                        mGL.bindTexture(mGL.TEXTURE_2D, null);
                                    }
                                    else if( type===me.TEXTYPE.T3D )
                                    {
                                        return null;
                                    }
                                    else 
                                    {
                                        mGL.bindTexture( mGL.TEXTURE_CUBE_MAP, id );
                                        mGL.pixelStorei(mGL.UNPACK_FLIP_Y_WEBGL, flipY);
                                        mGL.activeTexture( mGL.TEXTURE0 );
                                        mGL.texImage2D(  mGL.TEXTURE_CUBE_MAP_POSITIVE_X, 0, glFoTy.mGLFormat, glFoTy.mGLExternal, glFoTy.mGLType, image[0] );
                                        mGL.texImage2D(  mGL.TEXTURE_CUBE_MAP_NEGATIVE_X, 0, glFoTy.mGLFormat, glFoTy.mGLExternal, glFoTy.mGLType, image[1] );
                                        mGL.texImage2D(  mGL.TEXTURE_CUBE_MAP_POSITIVE_Y, 0, glFoTy.mGLFormat, glFoTy.mGLExternal, glFoTy.mGLType, (flipY ? image[3] : image[2]) );
                                        mGL.texImage2D(  mGL.TEXTURE_CUBE_MAP_NEGATIVE_Y, 0, glFoTy.mGLFormat, glFoTy.mGLExternal, glFoTy.mGLType, (flipY ? image[2] : image[3]) );
                                        mGL.texImage2D(  mGL.TEXTURE_CUBE_MAP_POSITIVE_Z, 0, glFoTy.mGLFormat, glFoTy.mGLExternal, glFoTy.mGLType, image[4] );
                                        mGL.texImage2D(  mGL.TEXTURE_CUBE_MAP_NEGATIVE_Z, 0, glFoTy.mGLFormat, glFoTy.mGLExternal, glFoTy.mGLType, image[5] );

                                        if( filter === me.FILTER.NONE)
                                        {
                                            mGL.texParameteri(mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MAG_FILTER, mGL.NEAREST);
                                            mGL.texParameteri(mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MIN_FILTER, mGL.NEAREST);
                                        }
                                        else if (filter === me.FILTER.LINEAR)
                                        {
                                            mGL.texParameteri( mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR );
                                            mGL.texParameteri( mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MIN_FILTER, mGL.LINEAR );
                                        }
                                        else if (filter === me.FILTER.MIPMAP)
                                        {
                                            mGL.texParameteri(mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR);
                                            mGL.texParameteri(mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MIN_FILTER, mGL.LINEAR_MIPMAP_LINEAR);
                                            mGL.generateMipmap( mGL.TEXTURE_CUBE_MAP );
                                        }
                                        mGL.pixelStorei(mGL.UNPACK_FLIP_Y_WEBGL, false);
                                        mGL.bindTexture( mGL.TEXTURE_CUBE_MAP, null );
                                    }
                                    return { mObjectID: id, mXres: image.width, mYres: image.height, mFormat: format, mType: type, mFilter: filter, mWrap:wrap, mVFlip:flipY };
                                };

        me.SetSamplerFilter = function (te, filter, doGenerateMipsIfNeeded) 
                            {
                                if (te.mFilter === filter) return;

                                filter = ApplyDeviceFilteringLimits(filter, te.mFormat);

                                if (te.mType === me.TEXTYPE.T2D) 
                                {
                                    mGL.bindTexture(mGL.TEXTURE_2D, te.mObjectID);

                                    if (filter === me.FILTER.NONE) 
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MAG_FILTER, mGL.NEAREST);
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MIN_FILTER, mGL.NEAREST);
                                    }
                                    else if (filter === me.FILTER.LINEAR) 
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR);
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MIN_FILTER, mGL.LINEAR);
                                    }
                                    else if (filter === me.FILTER.MIPMAP) 
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR);
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MIN_FILTER, mGL.LINEAR_MIPMAP_LINEAR);
                                        if( doGenerateMipsIfNeeded ) mGL.generateMipmap(mGL.TEXTURE_2D);
                                    }
                                    else
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MAG_FILTER, mGL.NEAREST);
                                        mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_MIN_FILTER, mGL.NEAREST_MIPMAP_LINEAR);
                                        if( doGenerateMipsIfNeeded ) mGL.generateMipmap(mGL.TEXTURE_2D);
                                    }

                                    mGL.bindTexture(mGL.TEXTURE_2D, null);

                                }
                                else if (te.mType === me.TEXTYPE.T3D) 
                                {
                                    mGL.bindTexture(mGL.TEXTURE_3D, te.mObjectID);

                                    if (filter === me.FILTER.NONE) 
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MAG_FILTER, mGL.NEAREST);
                                        mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MIN_FILTER, mGL.NEAREST);
                                    }
                                    else if (filter === me.FILTER.LINEAR) 
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR);
                                        mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MIN_FILTER, mGL.LINEAR);
                                    }
                                    else if (filter === me.FILTER.MIPMAP) 
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR);
                                        mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MIN_FILTER, mGL.LINEAR_MIPMAP_LINEAR);
                                        if( doGenerateMipsIfNeeded ) mGL.generateMipmap(mGL.TEXTURE_3D);
                                    }
                                    else
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MAG_FILTER, mGL.NEAREST);
                                        mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_MIN_FILTER, mGL.NEAREST_MIPMAP_LINEAR);
                                        if( doGenerateMipsIfNeeded ) mGL.generateMipmap(mGL.TEXTURE_3D);
                                    }

                                    mGL.bindTexture(mGL.TEXTURE_3D, null);

                                }
                                else
                                {
                                    mGL.bindTexture(mGL.TEXTURE_CUBE_MAP, te.mObjectID);

                                    if (filter === me.FILTER.NONE) 
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MAG_FILTER, mGL.NEAREST);
                                        mGL.texParameteri(mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MIN_FILTER, mGL.NEAREST);
                                    }
                                    else if (filter === me.FILTER.LINEAR) 
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR);
                                        mGL.texParameteri(mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MIN_FILTER, mGL.LINEAR);
                                    }
                                    else if (filter === me.FILTER.MIPMAP) 
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MAG_FILTER, mGL.LINEAR);
                                        mGL.texParameteri(mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MIN_FILTER, mGL.LINEAR_MIPMAP_LINEAR);
                                        if( doGenerateMipsIfNeeded ) mGL.generateMipmap(mGL.TEXTURE_CUBE_MAP);
                                    }
                                    else
                                    {
                                        mGL.texParameteri(mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MAG_FILTER, mGL.NEAREST);
                                        mGL.texParameteri(mGL.TEXTURE_CUBE_MAP, mGL.TEXTURE_MIN_FILTER, mGL.NEAREST_MIPMAP_LINEAR);
                                        if( doGenerateMipsIfNeeded ) mGL.generateMipmap(mGL.TEXTURE_CUBE_MAP);
                                    }

                                    mGL.bindTexture(mGL.TEXTURE_CUBE_MAP, null);
                                }


                                te.mFilter = filter;
                            };

        me.SetSamplerWrap = function (te, wrap)
                            {
                                if (te.mWrap === wrap) return;

                                var glWrap = mGL.REPEAT; if (wrap === me.TEXWRP.CLAMP) glWrap = mGL.CLAMP_TO_EDGE;

                                var id = te.mObjectID;

                                if (te.mType === me.TEXTYPE.T2D)
                                {
                                    mGL.bindTexture(mGL.TEXTURE_2D, id);
                                    mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_WRAP_S, glWrap);
                                    mGL.texParameteri(mGL.TEXTURE_2D, mGL.TEXTURE_WRAP_T, glWrap);
                                    mGL.bindTexture(mGL.TEXTURE_2D, null);

                                }
                                else if (te.mType === me.TEXTYPE.T3D)
                                {
                                    mGL.bindTexture(mGL.TEXTURE_3D, id);
                                    mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_WRAP_R, glWrap);
                                    mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_WRAP_S, glWrap);
                                    mGL.texParameteri(mGL.TEXTURE_3D, mGL.TEXTURE_WRAP_T, glWrap);
                                    mGL.bindTexture(mGL.TEXTURE_3D, null);
                                }

                                te.mWrap = wrap;
                            };

        me.SetSamplerVFlip = function (te, vflip, image)
                            {
                                if (te.mVFlip === vflip) return;

                                var id = te.mObjectID;

                                if (te.mType === me.TEXTYPE.T2D)
                                {
                                    if( image != null)
                                    {
                                        mGL.activeTexture( mGL.TEXTURE0 );
                                        mGL.bindTexture(mGL.TEXTURE_2D, id);
                                        mGL.pixelStorei(mGL.UNPACK_FLIP_Y_WEBGL, vflip);
                                        var glFoTy = iFormatPI2GL( te.mFormat );
                                        mGL.texImage2D(mGL.TEXTURE_2D, 0, glFoTy.mGLFormat, glFoTy.mGLExternal, glFoTy.mGLType, image);
                                        mGL.bindTexture(mGL.TEXTURE_2D, null);
                                        mGL.pixelStorei(mGL.UNPACK_FLIP_Y_WEBGL, false);
                                    }
                                }
                                else if (te.mType === me.TEXTYPE.CUBEMAP)
                                {
                                    if( image != null)
                                    {
                                        var glFoTy = iFormatPI2GL( te.mFormat );
                                        mGL.activeTexture( mGL.TEXTURE0 );
                                        mGL.bindTexture( mGL.TEXTURE_CUBE_MAP, id );
                                        mGL.pixelStorei( mGL.UNPACK_FLIP_Y_WEBGL, vflip);
                                        mGL.texImage2D(  mGL.TEXTURE_CUBE_MAP_POSITIVE_X, 0, glFoTy.mGLFormat, glFoTy.mGLExternal, glFoTy.mGLType, image[0] );
                                        mGL.texImage2D(  mGL.TEXTURE_CUBE_MAP_NEGATIVE_X, 0, glFoTy.mGLFormat, glFoTy.mGLExternal, glFoTy.mGLType, image[1] );
                                        mGL.texImage2D(  mGL.TEXTURE_CUBE_MAP_POSITIVE_Y, 0, glFoTy.mGLFormat, glFoTy.mGLExternal, glFoTy.mGLType, (vflip ? image[3] : image[2]) );
                                        mGL.texImage2D(  mGL.TEXTURE_CUBE_MAP_NEGATIVE_Y, 0, glFoTy.mGLFormat, glFoTy.mGLExternal, glFoTy.mGLType, (vflip ? image[2] : image[3]) );
                                        mGL.texImage2D(  mGL.TEXTURE_CUBE_MAP_POSITIVE_Z, 0, glFoTy.mGLFormat, glFoTy.mGLExternal, glFoTy.mGLType, image[4] );
                                        mGL.texImage2D(  mGL.TEXTURE_CUBE_MAP_NEGATIVE_Z, 0, glFoTy.mGLFormat, glFoTy.mGLExternal, glFoTy.mGLType, image[5] );
                                        mGL.bindTexture( mGL.TEXTURE_CUBE_MAP, null );
                                        mGL.pixelStorei(mGL.UNPACK_FLIP_Y_WEBGL, false);
                                    }
        
                                }

                                te.mVFlip = vflip;
                            };

        me.CreateMipmaps =  function (te)
                            {
                                if( te.mType===me.TEXTYPE.T2D )
                                {
                                    mGL.activeTexture(mGL.TEXTURE0);
                                    mGL.bindTexture(mGL.TEXTURE_2D, te.mObjectID);
                                    mGL.generateMipmap(mGL.TEXTURE_2D);
                                    mGL.bindTexture(mGL.TEXTURE_2D, null);
                                }
                                else if( te.mType===me.TEXTYPE.CUBEMAP )
                                {
                                    mGL.activeTexture(mGL.TEXTURE0);
                                    mGL.bindTexture(mGL.TEXTURE_CUBE_MAP, te.mObjectID);
                                    mGL.generateMipmap( mGL.TEXTURE_CUBE_MAP );
                                    mGL.bindTexture(mGL.TEXTURE_CUBE_MAP, null);
                                }
                            };

        me.UpdateTexture =  function( tex, x0, y0, xres, yres, buffer )
                            {
                                var glFoTy = iFormatPI2GL( tex.mFormat );
                                if( tex.mType===me.TEXTYPE.T2D )
                                {
                                    mGL.activeTexture( mGL.TEXTURE0);
                                    mGL.bindTexture( mGL.TEXTURE_2D, tex.mObjectID );
                                    mGL.pixelStorei(mGL.UNPACK_FLIP_Y_WEBGL, tex.mVFlip );
                                    mGL.texSubImage2D( mGL.TEXTURE_2D, 0, x0, y0, xres, yres, glFoTy.mGLExternal, glFoTy.mGLType, buffer );
                                    mGL.bindTexture( mGL.TEXTURE_2D, null );
                                    mGL.pixelStorei(mGL.UNPACK_FLIP_Y_WEBGL, false);
                                }
                            };

        me.UpdateTextureFromImage = function( tex, image )
                                {
                                    var glFoTy = iFormatPI2GL( tex.mFormat );
                                    if( tex.mType===me.TEXTYPE.T2D )
                                    {
                                        mGL.activeTexture( mGL.TEXTURE0 );
                                        mGL.bindTexture( mGL.TEXTURE_2D, tex.mObjectID );
                                        mGL.pixelStorei(mGL.UNPACK_FLIP_Y_WEBGL, tex.mVFlip );
                                        mGL.texImage2D(  mGL.TEXTURE_2D, 0, glFoTy.mGLFormat, glFoTy.mGLExternal, glFoTy.mGLType, image );
                                        mGL.bindTexture( mGL.TEXTURE_2D, null );
                                        mGL.pixelStorei(mGL.UNPACK_FLIP_Y_WEBGL, false);
                                    }
                                };

        me.DestroyTexture = function( te )
                            {
                                 mGL.deleteTexture( te.mObjectID );
                            };

        me.AttachTextures = function (num, t0, t1, t2, t3) 
                            {
                                if (num > 0 && t0 != null) 
                                {
                                    mGL.activeTexture(mGL.TEXTURE0);
                                         if (t0.mType === me.TEXTYPE.T2D) mGL.bindTexture(mGL.TEXTURE_2D, t0.mObjectID);
                                    else if (t0.mType === me.TEXTYPE.T3D) mGL.bindTexture(mGL.TEXTURE_3D, t0.mObjectID);
                                    else if (t0.mType === me.TEXTYPE.CUBEMAP) mGL.bindTexture(mGL.TEXTURE_CUBE_MAP, t0.mObjectID);
                                }

                                if (num > 1 && t1 != null) 
                                {
                                    mGL.activeTexture(mGL.TEXTURE1);
                                         if (t1.mType === me.TEXTYPE.T2D) mGL.bindTexture(mGL.TEXTURE_2D, t1.mObjectID);
                                    else if (t1.mType === me.TEXTYPE.T3D) mGL.bindTexture(mGL.TEXTURE_3D, t1.mObjectID);
                                    else if (t1.mType === me.TEXTYPE.CUBEMAP) mGL.bindTexture(mGL.TEXTURE_CUBE_MAP, t1.mObjectID);
                                }

                                if (num > 2 && t2 != null) 
                                {
                                    mGL.activeTexture(mGL.TEXTURE2);
                                         if (t2.mType === me.TEXTYPE.T2D) mGL.bindTexture(mGL.TEXTURE_2D, t2.mObjectID);
                                    else if (t2.mType === me.TEXTYPE.T3D) mGL.bindTexture(mGL.TEXTURE_3D, t2.mObjectID);
                                    else if (t2.mType === me.TEXTYPE.CUBEMAP) mGL.bindTexture(mGL.TEXTURE_CUBE_MAP, t2.mObjectID);
                                }

                                if (num > 3 && t3 != null) 
                                {
                                    mGL.activeTexture(mGL.TEXTURE3);
                                         if (t3.mType === me.TEXTYPE.T2D) mGL.bindTexture(mGL.TEXTURE_2D, t3.mObjectID);
                                    else if (t3.mType === me.TEXTYPE.T3D) mGL.bindTexture(mGL.TEXTURE_3D, t3.mObjectID);
                                    else if (t3.mType === me.TEXTYPE.CUBEMAP) mGL.bindTexture(mGL.TEXTURE_CUBE_MAP, t3.mObjectID);
                                }
                            };

        me.DettachTextures = function()
                             {
                                mGL.activeTexture(mGL.TEXTURE0);
                                mGL.bindTexture(mGL.TEXTURE_2D, null);
                                mGL.bindTexture(mGL.TEXTURE_CUBE_MAP, null);

                                mGL.activeTexture(mGL.TEXTURE1);
                                mGL.bindTexture(mGL.TEXTURE_2D, null);
                                mGL.bindTexture(mGL.TEXTURE_CUBE_MAP, null);

                                mGL.activeTexture(mGL.TEXTURE2);
                                mGL.bindTexture(mGL.TEXTURE_2D, null);
                                mGL.bindTexture(mGL.TEXTURE_CUBE_MAP, null);

                                mGL.activeTexture(mGL.TEXTURE3);
                                mGL.bindTexture(mGL.TEXTURE_2D, null);
                                mGL.bindTexture(mGL.TEXTURE_CUBE_MAP, null);
                             };

        me.CreateRenderTarget = function ( color0, color1, color2, color3, depth, wantZbuffer )
                                {
                                    var id =  mGL.createFramebuffer();
                                    mGL.bindFramebuffer(mGL.FRAMEBUFFER, id);

                                    if (depth === null)
                                    {
                                        if( wantZbuffer===true )
                                        {
                                            var zb = mGL.createRenderbuffer();
                                            mGL.bindRenderbuffer(mGL.RENDERBUFFER, zb);
                                            mGL.renderbufferStorage(mGL.RENDERBUFFER, mGL.DEPTH_COMPONENT16, color0.mXres, color0.mYres);

                                            mGL.framebufferRenderbuffer(mGL.FRAMEBUFFER, mGL.DEPTH_ATTACHMENT, mGL.RENDERBUFFER, zb);
                                        }
                                    }
                                    else
                                    {
                                        mGL.framebufferTexture2D(mGL.FRAMEBUFFER, mGL.DEPTH_ATTACHMENT, mGL.TEXTURE_2D, depth.mObjectID, 0);
                                    }

                                    if( color0 !=null ) mGL.framebufferTexture2D(mGL.FRAMEBUFFER, mGL.COLOR_ATTACHMENT0, mGL.TEXTURE_2D, color0.mObjectID, 0);

                                    if (mGL.checkFramebufferStatus(mGL.FRAMEBUFFER) != mGL.FRAMEBUFFER_COMPLETE)
                                        return null;

                                    mGL.bindRenderbuffer(mGL.RENDERBUFFER, null);
                                    mGL.bindFramebuffer(mGL.FRAMEBUFFER, null);
                                    return { mObjectID: id, mTex0: color0 };
                                };

        me.DestroyRenderTarget = function ( tex )
                                 {
                                     mGL.deleteFramebuffer(tex.mObjectID);
                                 };

        me.SetRenderTarget = function (tex)
                             {
                                if( tex===null )
                                    mGL.bindFramebuffer(mGL.FRAMEBUFFER, null);
                                else
                                    mGL.bindFramebuffer(mGL.FRAMEBUFFER, tex.mObjectID);

                                //mGL.drawBuffers([mGL.COLOR_ATTACHMENT0, mGL.COLOR_ATTACHMENT1]);
                             };

        me.CreateRenderTargetNew = function ( wantColor0, wantZbuffer, xres, yres, samples )
                                {
                                    var id =  mGL.createFramebuffer();
                                    mGL.bindFramebuffer(mGL.FRAMEBUFFER, id);

                                    if( wantZbuffer===true )
                                    {
                                        var zb = mGL.createRenderbuffer();
                                        mGL.bindRenderbuffer(mGL.RENDERBUFFER, zb);

                                        if( samples==1 )
                                        mGL.renderbufferStorage(mGL.RENDERBUFFER, mGL.DEPTH_COMPONENT16, xres, yres);
                                        else
                                        mGL.renderbufferStorageMultisample(mGL.RENDERBUFFER, samples, mGL.DEPTH_COMPONENT16, xres, yres);
                                        mGL.framebufferRenderbuffer(mGL.FRAMEBUFFER, mGL.DEPTH_ATTACHMENT, mGL.RENDERBUFFER, zb);
                                    }

                                    if( wantColor0 )
                                    {
                                        var cb = mGL.createRenderbuffer();
                                        mGL.bindRenderbuffer(mGL.RENDERBUFFER, cb);
                                        if( samples==1 )
                                        mGL.renderbufferStorage(mGL.RENDERBUFFER, mGL.RGBA8, xres, yres);
                                        else
                                        mGL.renderbufferStorageMultisample(mGL.RENDERBUFFER, samples, mGL.RGBA8, xres, yres);
                                        mGL.framebufferRenderbuffer(mGL.FRAMEBUFFER, mGL.COLOR_ATTACHMENT0, mGL.RENDERBUFFER, cb);
                                    }

                                    if (mGL.checkFramebufferStatus(mGL.FRAMEBUFFER) != mGL.FRAMEBUFFER_COMPLETE)
                                    {
                                        return null;
                                    }
                                    mGL.bindRenderbuffer(mGL.RENDERBUFFER, null);
                                    mGL.bindFramebuffer(mGL.FRAMEBUFFER, null);
                                    return { mObjectID: id, mXres: xres, mYres:yres, mTex0: color0 };
                                };

        me.CreateRenderTargetCubeMap = function ( color0, depth, wantZbuffer )
                                {
                                    var id =  mGL.createFramebuffer();
                                    mGL.bindFramebuffer(mGL.FRAMEBUFFER, id);

                                    if (depth === null)
                                    {
                                        if( wantZbuffer===true )
                                        {
                                            var zb = mGL.createRenderbuffer();
                                            mGL.bindRenderbuffer(mGL.RENDERBUFFER, zb);
                                            mGL.renderbufferStorage(mGL.RENDERBUFFER, mGL.DEPTH_COMPONENT16, color0.mXres, color0.mYres);
                                            mGL.framebufferRenderbuffer(mGL.FRAMEBUFFER, mGL.DEPTH_ATTACHMENT, mGL.RENDERBUFFER, zb);
                                        }
                                    }
                                    else
                                    {
                                        mGL.framebufferTexture2D(mGL.FRAMEBUFFER, mGL.DEPTH_ATTACHMENT, mGL.TEXTURE_2D, depth.mObjectID, 0);
                                    }

                                    if( color0 !=null ) mGL.framebufferTexture2D(mGL.FRAMEBUFFER, mGL.COLOR_ATTACHMENT0, mGL.TEXTURE_CUBE_MAP_POSITIVE_X, color0.mObjectID, 0);

                                    if (mGL.checkFramebufferStatus(mGL.FRAMEBUFFER) != mGL.FRAMEBUFFER_COMPLETE)
                                        return null;

                                    mGL.bindRenderbuffer(mGL.RENDERBUFFER, null);
                                    mGL.bindFramebuffer(mGL.FRAMEBUFFER, null);
                                    return { mObjectID: id, mTex0: color0 };
                                };

        me.SetRenderTargetCubeMap = function (fbo, face)
                             {
                                if( fbo===null )
                                    mGL.bindFramebuffer(mGL.FRAMEBUFFER, null);
                                else
                                {
                                    mGL.bindFramebuffer(mGL.FRAMEBUFFER, fbo.mObjectID);
                                    mGL.framebufferTexture2D(mGL.FRAMEBUFFER, mGL.COLOR_ATTACHMENT0, mGL.TEXTURE_CUBE_MAP_POSITIVE_X+face, fbo.mTex0.mObjectID, 0);
                                }
                             };


        me.BlitRenderTarget = function( dst, src )
                                {
                                    mGL.bindFramebuffer(mGL.READ_FRAMEBUFFER, src.mObjectID);
                                    mGL.bindFramebuffer(mGL.DRAW_FRAMEBUFFER, dst.mObjectID);
                                    mGL.clearBufferfv(mGL.COLOR, 0, [0.0, 0.0, 0.0, 1.0]);
                                    mGL.blitFramebuffer( 0, 0, src.mXres, src.mYres,
                                                         0, 0, src.mXres, src.mYres,
                                                         mGL.COLOR_BUFFER_BIT, mGL.LINEAR
                                    );
                                };

        me.SetViewport = function( vp )
                         {
                              mGL.viewport( vp[0], vp[1], vp[2], vp[3] );
                         };

        me.SetWriteMask = function( c0, c1, c2, c3, z )
                          {
                              mGL.depthMask(z);
                              mGL.colorMask(c0,c0,c0,c0);
                          };

        me.SetState = function( stateName, stateValue )
                      {
                            if (stateName === me.RENDSTGATE.WIREFRAME)
                            {
                                if( stateValue ) mGL.polygonMode( mGL.FRONT_AND_BACK, mGL.LINE );
                                else             mGL.polygonMode( mGL.FRONT_AND_BACK, mGL.FILL );
                            }
                            else if (stateName === me.RENDSTGATE.FRONT_FACE)
                            {
                                if( stateValue ) mGL.cullFace( mGL.BACK );
                                else             mGL.cullFace( mGL.FRONT );
                            }
                            else if (stateName === me.RENDSTGATE.CULL_FACE)
                            {
                                if( stateValue ) mGL.enable( mGL.CULL_FACE );
                                else             mGL.disable( mGL.CULL_FACE );
                            }
                            else if (stateName === me.RENDSTGATE.DEPTH_TEST)
                            {
                                if( stateValue ) mGL.enable( mGL.DEPTH_TEST );
                                else             mGL.disable( mGL.DEPTH_TEST );
                            }
                            else if (stateName === me.RENDSTGATE.ALPHA_TO_COVERAGE)
                            {
                                if( stateValue ) { mGL.enable(  mGL.SAMPLE_ALPHA_TO_COVERAGE ); }
                                else             { mGL.disable( mGL.SAMPLE_ALPHA_TO_COVERAGE ); }
                            }
                      };

        me.SetMultisample = function( v)
                    {
                        if( v===true )
                        {
                            mGL.enable(mGL.SAMPLE_COVERAGE);
                            mGL.sampleCoverage(1.0, false);
                        }
                        else
                        {
                            mGL.disable(mGL.SAMPLE_COVERAGE);
                        }
                    };

        me.GetTranslatedShaderSource = function (shader) 
                          {
                            if( mGL===null ) return null;
                            if( mDebugShader===null ) return null;
                            let vfs = mGL.getAttachedShaders(shader.mProgram);
                            let str = mDebugShader.getTranslatedShaderSource(vfs[1]);
                            let parts = str.split("GLSL END"); str = (parts.length<2) ? str : parts[1];
                            return str;
                          };

        me.CreateShader = function (vsSource, fsSource, preventCache, forceSynch, onResolve) 
                          {
                            if( mGL===null ) return;

                            var vs = mGL.createShader( mGL.VERTEX_SHADER   );
                            var fs = mGL.createShader( mGL.FRAGMENT_SHADER );

                            vsSource = mShaderHeader[0] + vsSource;
                            fsSource = mShaderHeader[1] + fsSource;

                            if( preventCache )
                            {
                                let vran = Math.random().toString(36).substring(7);
                                let fran = Math.random().toString(36).substring(7);
                                vsSource += "\n#define K" + vran + "\n";
                                fsSource += "\n#define K" + fran + "\n";
                            }

                            var timeStart = getRealTime();

                            mGL.shaderSource(vs, vsSource);
                            mGL.shaderSource(fs, fsSource);
                            mGL.compileShader(vs);
                            mGL.compileShader(fs);

                            var pr = mGL.createProgram();
                            mGL.attachShader(pr, vs);
                            mGL.attachShader(pr, fs);
                            mGL.linkProgram(pr);

                            //-------------
                            let checkErrors = function()
                            {
                                if (!mGL.getProgramParameter(pr, mGL.LINK_STATUS))
                                {
                                    // vs error
                                    if (!mGL.getShaderParameter(vs, mGL.COMPILE_STATUS))
                                    {
                                        let vsLog = mGL.getShaderInfoLog(vs);
                                        onResolve(false, { mErrorType: 0, mErrorStr: vsLog });
                                        mGL.deleteProgram(pr);
                                    }
                                    // fs error
                                    else if (!mGL.getShaderParameter(fs, mGL.COMPILE_STATUS))
                                    {
                                        let fsLog = mGL.getShaderInfoLog(fs);
                                        onResolve(false, { mErrorType: 1, mErrorStr: fsLog });
                                        mGL.deleteProgram(pr);
                                    }
                                    // link error
                                    else
                                    {
                                        let infoLog = mGL.getProgramInfoLog(pr);
                                        onResolve(false, { mErrorType: 2, mErrorStr: infoLog });
                                        mGL.deleteProgram(pr);
                                    }
                                }
                                // no errors
                                else
                                {
                                    let compilationTime = getRealTime() - timeStart;
                                    onResolve(true, { mProgram: pr, mTime: compilationTime });
                                }
                            };

                            // check compilation
                            if (mAsynchCompile === null || forceSynch===true )
                            {
                                checkErrors();
                            }
                            else
                            {
                                let loopCheckCompletion = function ()
                                {
                                    if( mGL.getProgramParameter(pr, mAsynchCompile.COMPLETION_STATUS_KHR) === true )
                                        checkErrors();
                                    else
                                        setTimeout(loopCheckCompletion, 10);
                                };
                                setTimeout(loopCheckCompletion, 10);
                            }
                        };

        me.AttachShader = function( shader )
                          {
                                if( shader===null )
                                {
                                    mBindedShader = null;
                                    mGL.useProgram( null );
                                }
                                else
                                {
                                    mBindedShader = shader;
                                    mGL.useProgram(shader.mProgram);
                                }
                          };

        me.DetachShader = function ()
                        {
                            mGL.useProgram(null);
                        };

        me.DestroyShader = function( tex )
                        {
                            mGL.deleteProgram(tex.mProgram);
                        };

        me.GetAttribLocation = function (shader, name)
                        {
                            return mGL.getAttribLocation(shader.mProgram, name);
                        };

        me.SetShaderConstantLocation = function (shader, name)
                        {
                            return mGL.getUniformLocation(shader.mProgram, name);
                        };

        me.SetShaderConstantMat4F = function( uname, params, istranspose )
                        {
                            var program = mBindedShader;

                            let pos = mGL.getUniformLocation( program.mProgram, uname );
                            if( pos===null )
                                return false;

                            if( istranspose===false )
                            {
                                var tmp = new Float32Array( [ params[0], params[4], params[ 8], params[12],
                                                              params[1], params[5], params[ 9], params[13],
                                                              params[2], params[6], params[10], params[14],
                                                              params[3], params[7], params[11], params[15] ] );
	                            mGL.uniformMatrix4fv(pos,false,tmp);
                            }
                            else
                                mGL.uniformMatrix4fv(pos,false,new Float32Array(params) );
                            return true;
                        };

        me.SetShaderConstant1F_Pos = function(pos, x)
                        {
                            mGL.uniform1f(pos, x);
                            return true;
                        };

        me.SetShaderConstant1FV_Pos = function(pos, x)
                        {
                            mGL.uniform1fv(pos, x);
                            return true;
                        };

        me.SetShaderConstant1F = function( uname, x )
                        {
                            var pos = mGL.getUniformLocation(mBindedShader.mProgram, uname);
                            if (pos === null)
                                return false;
                            mGL.uniform1f(pos, x);
                            return true;
                        };

        me.SetShaderConstant1I = function(uname, x)
                        {
                            let pos = mGL.getUniformLocation(mBindedShader.mProgram, uname);
                            if (pos === null)
                                return false;
                            mGL.uniform1i(pos, x);
                            return true;
                        };
        me.SetShaderConstant1I_Pos = function(pos, x)
                        {
                            mGL.uniform1i(pos, x);
                            return true;
                        };


        me.SetShaderConstant2F = function(uname, x)
                        {
                            let pos = mGL.getUniformLocation(mBindedShader.mProgram, uname);
                            if (pos === null)
                                return false;
                            mGL.uniform2fv(pos, x);
                            return true;
                        };

        me.SetShaderConstant3F = function(uname, x, y, z)
                        {
                            let pos = mGL.getUniformLocation(mBindedShader.mProgram, uname);
                            if (pos === null)
                                return false;
                            mGL.uniform3f(pos, x, y, z);
                            return true;
                        };

        me.SetShaderConstant1FV = function(uname, x)
                        {
                            let pos = mGL.getUniformLocation(mBindedShader.mProgram, uname);
                            if (pos === null)
                                return false;
                            mGL.uniform1fv(pos, new Float32Array(x));
                            return true;
                        };

        me.SetShaderConstant3FV = function(uname, x) 
                        {
                            let pos = mGL.getUniformLocation(mBindedShader.mProgram, uname);
                            if (pos === null) return false;
                            mGL.uniform3fv(pos, new Float32Array(x) );
                            return true;
                        };

        me.SetShaderConstant4FV = function(uname, x) 
                        {
                            let pos = mGL.getUniformLocation(mBindedShader.mProgram, uname);
                            if (pos === null) return false;
                            mGL.uniform4fv(pos, new Float32Array(x) );
                            return true;
                        };

        me.SetShaderTextureUnit = function( uname, unit )
                        {
                            var program = mBindedShader;
                            let pos = mGL.getUniformLocation(program.mProgram, uname);
                            if (pos === null) return false;
                            mGL.uniform1i(pos, unit);
                            return true;
                        };

        me.CreateVertexArray = function( data, mode )
                        {
                            let id = mGL.createBuffer();
                            mGL.bindBuffer(mGL.ARRAY_BUFFER, id);
                            if (mode === me.BUFTYPE.STATIC)
                                mGL.bufferData(mGL.ARRAY_BUFFER, data, mGL.STATIC_DRAW);
                            else
                                mGL.bufferData(mGL.ARRAY_BUFFER, data, mGL.DYNAMIC_DRAW);
                            return { mObject: id };
                        };

        me.CreateIndexArray = function( data, mode )
                        {
                            let id = mGL.createBuffer();
                            mGL.bindBuffer(mGL.ELEMENT_ARRAY_BUFFER, id );
                            if (mode === me.BUFTYPE.STATIC)
                                mGL.bufferData(mGL.ELEMENT_ARRAY_BUFFER, data, mGL.STATIC_DRAW);
                            else
                                mGL.bufferData(mGL.ELEMENT_ARRAY_BUFFER, data, mGL.DYNAMIC_DRAW);
                            return { mObject: id };
                        };

        me.DestroyArray = function( tex )
                        {
                            mGL.destroyBuffer(tex.mObject);
                        };

        me.AttachVertexArray = function( tex, attribs, pos )
                        {
                            let shader = mBindedShader;

                            mGL.bindBuffer( mGL.ARRAY_BUFFER, tex.mObject);

                            var num = attribs.mChannels.length;
                            var stride = attribs.mStride;

                            var offset = 0;
                            for (var i = 0; i < num; i++)
                            {
                                var id = pos[i];
                                mGL.enableVertexAttribArray(id);
                                var dtype = mGL.FLOAT;
                                var dsize = 4;
                                     if( attribs.mChannels[i].mType === me.TYPE.UINT8   ) { dtype = mGL.UNSIGNED_BYTE;  dsize = 1; }
                                else if( attribs.mChannels[i].mType === me.TYPE.UINT16  ) { dtype = mGL.UNSIGNED_SHORT; dsize = 2; }
                                else if( attribs.mChannels[i].mType === me.TYPE.FLOAT32 ) { dtype = mGL.FLOAT;          dsize = 4; }
                                mGL.vertexAttribPointer(id, attribs.mChannels[i].mNumComponents, dtype, attribs.mChannels[i].mNormalize, stride, offset);
                                offset += attribs.mChannels[i].mNumComponents * dsize;
                            }
                        };

        me.AttachIndexArray = function( tex )
                        {
                            mGL.bindBuffer(mGL.ELEMENT_ARRAY_BUFFER, tex.mObject);
                        };

        me.DetachVertexArray = function (tex, attribs)
                        {
                            let num = attribs.mChannels.length;
                            for (let i = 0; i < num; i++)
                                mGL.disableVertexAttribArray(i);
                            mGL.bindBuffer(mGL.ARRAY_BUFFER, null);
                        };

        me.DetachIndexArray = function( tex )
                        {
                            mGL.bindBuffer(mGL.ELEMENT_ARRAY_BUFFER, null);
                        };

        me.DrawPrimitive = function( typeOfPrimitive, num, useIndexArray, numInstances )
                        {
                            let glType = mGL.POINTS;
                            if( typeOfPrimitive===me.PRIMTYPE.POINTS ) glType = mGL.POINTS;
                            if( typeOfPrimitive===me.PRIMTYPE.LINES ) glType = mGL.LINES;
                            if( typeOfPrimitive===me.PRIMTYPE.LINE_LOOP ) glType = mGL.LINE_LOOP;
                            if( typeOfPrimitive===me.PRIMTYPE.LINE_STRIP ) glType = mGL.LINE_STRIP;
                            if( typeOfPrimitive===me.PRIMTYPE.TRIANGLES ) glType = mGL.TRIANGLES;
                            if( typeOfPrimitive===me.PRIMTYPE.TRIANGLE_STRIP ) glType = mGL.TRIANGLE_STRIP;

                            if( numInstances<=1 )
                            {
  	                            if( useIndexArray ) mGL.drawElements( glType, num, mGL.UNSIGNED_SHORT, 0 );
	                            else                mGL.drawArrays( glType, 0, num );
                            }
                            else
                            {
                                mGL.drawArraysInstanced(glType, 0, num, numInstances);
                                mGL.drawElementsInstanced( glType, num, mGL.UNSIGNED_SHORT, 0, numInstances);
                            }
                        };


        me.DrawFullScreenTriangle_XY = function( vpos )
                        {
                            mGL.bindBuffer( mGL.ARRAY_BUFFER, mVBO_Tri );
                            mGL.vertexAttribPointer( vpos, 2, mGL.FLOAT, false, 0, 0 );
                            mGL.enableVertexAttribArray( vpos );
                            mGL.drawArrays( mGL.TRIANGLES, 0, 3 );
                            mGL.disableVertexAttribArray( vpos );
                            mGL.bindBuffer( mGL.ARRAY_BUFFER, null );
                        };


        me.DrawUnitQuad_XY = function( vpos )
                        {
                            mGL.bindBuffer( mGL.ARRAY_BUFFER, mVBO_Quad );
                            mGL.vertexAttribPointer( vpos, 2, mGL.FLOAT, false, 0, 0 );
                            mGL.enableVertexAttribArray( vpos );
                            mGL.drawArrays( mGL.TRIANGLES, 0, 6 );
                            mGL.disableVertexAttribArray( vpos );
                            mGL.bindBuffer( mGL.ARRAY_BUFFER, null );
                        };

        me.DrawUnitCube_XYZ_NOR = function( vpos )
                        {
                            mGL.bindBuffer( mGL.ARRAY_BUFFER, mVBO_CubePosNor );
                            mGL.vertexAttribPointer( vpos[0], 3, mGL.FLOAT, false, 0, 0 );
                            mGL.vertexAttribPointer( vpos[1], 3, mGL.FLOAT, false, 0, 0 );
                            mGL.enableVertexAttribArray( vpos[0] );
                            mGL.enableVertexAttribArray( vpos[1] );
                            mGL.drawArrays(mGL.TRIANGLE_STRIP, 0, 4);
                            mGL.drawArrays(mGL.TRIANGLE_STRIP, 4, 4);
                            mGL.drawArrays(mGL.TRIANGLE_STRIP, 8, 4);
                            mGL.drawArrays(mGL.TRIANGLE_STRIP, 12, 4);
                            mGL.drawArrays(mGL.TRIANGLE_STRIP, 16, 4);
                            mGL.drawArrays(mGL.TRIANGLE_STRIP, 20, 4);
                            mGL.disableVertexAttribArray( vpos[0] );
                            mGL.disableVertexAttribArray( vpos[1] );
                            mGL.bindBuffer( mGL.ARRAY_BUFFER, null );
                        }

        me.DrawUnitCube_XYZ = function( vpos )
                        {
                            mGL.bindBuffer( mGL.ARRAY_BUFFER, mVBO_CubePos );
                            mGL.vertexAttribPointer( vpos, 3, mGL.FLOAT, false, 0, 0 );
                            mGL.enableVertexAttribArray( vpos );
                            mGL.drawArrays(mGL.TRIANGLE_STRIP, 0, 4);
                            mGL.drawArrays(mGL.TRIANGLE_STRIP, 4, 4);
                            mGL.drawArrays(mGL.TRIANGLE_STRIP, 8, 4);
                            mGL.drawArrays(mGL.TRIANGLE_STRIP, 12, 4);
                            mGL.drawArrays(mGL.TRIANGLE_STRIP, 16, 4);
                            mGL.drawArrays(mGL.TRIANGLE_STRIP, 20, 4);
                            mGL.disableVertexAttribArray( vpos );
                            mGL.bindBuffer( mGL.ARRAY_BUFFER, null );
                        }

        me.SetBlend = function( enabled )
                    {
                        if( enabled )
                        {
                            mGL.enable( mGL.BLEND );
                            mGL.blendEquationSeparate( mGL.FUNC_ADD, mGL.FUNC_ADD );
                            mGL.blendFuncSeparate( mGL.SRC_ALPHA, mGL.ONE_MINUS_SRC_ALPHA, mGL.ONE, mGL.ONE_MINUS_SRC_ALPHA );
                        }
                        else
                        {
                            mGL.disable( mGL.BLEND );
                        }
                    };

        me.GetPixelData = function( data, offset, xres, yres )
                        {
                            mGL.readPixels(0, 0, xres, yres, mGL.RGBA, mGL.UNSIGNED_BYTE, data, offset);
                        };

        me.GetPixelDataRenderTarget = function( obj, data, xres, yres )
                        {
                            mGL.bindFramebuffer(mGL.FRAMEBUFFER, obj.mObjectID);
                            mGL.readBuffer(mGL.COLOR_ATTACHMENT0);
                            mGL.readPixels(0, 0, xres, yres, mGL.RGBA, mGL.FLOAT, data, 0);
                            mGL.bindFramebuffer(mGL.FRAMEBUFFER, null);
                        };
    return me;
}
//==============================================================================
//
// piLibs 2015-2017 - http://www.iquilezles.org/www/material/piLibs/piLibs.htm
//
// piShading
//
//==============================================================================

function smoothstep(a, b, x)
{
    x = (x - a) / (b - a);
    if (x < 0) x = 0; else if (x > 1) x = 1;
    return x * x * (3.0 - 2.0 * x);
}

function clamp01(x)
{
    if( x < 0.0 ) x = 0.0;
    if( x > 1.0 ) x = 1.0;
    return x;
}

function clamp(x, a, b)
{
    if( x < a ) x = a;
    if( x > b ) x = b;
    return x;
}

function screen(a, b)
{
    return 1.0 - (1.0 - a) * (1.0 - b);
}

function parabola(x)
{
    return 4.0 * x * (1.0 - x);
}

function min(a, b)
{
    return (a < b) ? a : b;
}

function max(a, b)
{
    return (a > b) ? a : b;
}

function noise( x )
{
    function grad(i, j, x, y)
    {
        var h = 7 * i + 131 * j;
        h = (h << 13) ^ h;
        h = (h * (h * h * 15731 + 789221) + 1376312589);

        var rx = (h & 0x20000000) ? x : -x;
        var ry = (h & 0x10000000) ? y : -y;

        return rx + ry;
    }

    var i = [ Math.floor(x[0]), Math.floor(x[1]) ];
    var f = [ x[0] - i[0], x[1] - i[1] ];
    var w = [ f[0]*f[0]*(3.0-2.0*f[0]), f[1]*f[1]*(3.0-2.0*f[1]) ];

    var a = grad( i[0]+0, i[1]+0, f[0]+0.0, f[1]+0.0 );
    var b = grad( i[0]+1, i[1]+0, f[0]-1.0, f[1]+0.0 );
    var c = grad( i[0]+0, i[1]+1, f[0]+0.0, f[1]-1.0 );
    var d = grad( i[0]+1, i[1]+1, f[0]-1.0, f[1]-1.0 );

    return a + (b-a)*w[0] + (c-a)*w[1] + (a-b-c+d)*w[0]*w[1];
}//==============================================================================
//
// piLibs 2015-2017 - http://www.iquilezles.org/www/material/piLibs/piLibs.htm
//
// piVecTypes
//
//==============================================================================


function vec3( a, b, c )
{
    return [ a, b, c ];
}

function add( a, b )
{
    return [ a[0]+b[0], a[1]+b[1], a[2]+b[2] ];
}

function sub( a, b )
{
    return [ a[0]-b[0], a[1]-b[1], a[2]-b[2] ];
}

function mul( a, s ) 
{
    return [ a[0]*s, a[1]*s, a[2]*s ];
}

function cross( a, b )
{
    return [ a[1]*b[2] - a[2]*b[1],
             a[2]*b[0] - a[0]*b[2],
             a[0]*b[1] - a[1]*b[0] ];
}

function dot( a, b ) 
{
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}

function normalize( v ) 
{
    var is = 1.0 / Math.sqrt( v[0]*v[0] + v[1]*v[1] + v[2]*v[2] );
    return [ v[0]*is, v[1]*is, v[2]*is ];
}

function createCirclePoint( cen, uuu, vvv, rad, s, t )
{
    return [ cen[0] + rad*(uuu[0]*s + vvv[0]*t),
             cen[1] + rad*(uuu[1]*s + vvv[1]*t),
             cen[2] + rad*(uuu[2]*s + vvv[2]*t) ];
}

function createTangent( a, b, c )
{
    var cb = normalize( [ c[0]-b[0], c[1]-b[1], c[2]-b[2] ] );
    var ba = normalize( [ b[0]-a[0], b[1]-a[1], b[2]-a[2] ] );
    return normalize( [ ba[0]+cb[0], ba[1]+cb[1], ba[2]+cb[2] ] );

}

//===================================

function vec4( a, b, c, d )
{
    return [ a, b, c, d ];
}

function getXYZ( v )
{
    return [ v[0], v[1], v[2] ];
}

//===================================

function setIdentity()
{
    return [ 1.0, 0.0, 0.0, 0.0,
             0.0, 1.0, 0.0, 0.0,
             0.0, 0.0, 1.0, 0.0,
             0.0, 0.0, 0.0, 1.0 ];
}

function setRotationX( t )
{
    var sint = Math.sin(t);
    var cost = Math.cos(t);

    return [ 1.0,   0.0,   0.0, 0.0,
             0.0,  cost, -sint, 0.0, 
             0.0,  sint,  cost, 0.0,
             0.0,   0.0,   0.0, 1.0 ];
}

function setRotationY( t )
{
    var sint = Math.sin(t);
    var cost = Math.cos(t);

    return [ cost, 0.0, -sint, 0.0,
              0.0, 1.0,   0.0, 0.0, 
             sint, 0.0,  cost, 0.0,
              0.0, 0.0,   0.0, 1.0 ];
}

function extractRotationEuler( m)
{
    var res = [];
    if (m[0] == 1.0)
    {
        res[0] = Math.atan2(m[2], m[11]);
        res[1] = 0.0;
        res[2] = 0.0;

    }
    else if (m[0] == -1.0)
    {
        res[0] = Math.atan2( m[2], m[11]);
        res[1] = 0.0;
        res[2] = 0.0;
    }
    else
    {
        res[0] = Math.atan2( -m[9], m[10]);
        res[1] = Math.atan2( m[8], Math.sqrt(m[9]*m[9] + m[10]*m[10]));
        res[2] = Math.atan2( m[4], m[0]);
    }
    return res;
}

function setFromQuaternion( q )
{
    var ww = q[3]*q[3];
    var xx = q[0]*q[0];
    var yy = q[1]*q[1];
    var zz = q[2]*q[2];

    return [ ww+xx-yy-zz,                   2.0*(q[0]*q[1] - q[3]*q[2]), 2.0*(q[0]*q[2] + q[3]*q[1]), 0.0,
               2.0*(q[0]*q[1] + q[3]*q[2]),   ww-xx+yy-zz,                 2.0*(q[1]*q[2] - q[3]*q[0]), 0.0,
               2.0*(q[0]*q[2] - q[3]*q[1]),   2.0*(q[1]*q[2] + q[3]*q[0]), ww-xx-yy+zz,                 0.0,
               0.0,                           0.0,                         0.0,                         1.0 ];
}

function setPerspective( fovy, aspect, znear, zfar )
{
    var tan = Math.tan(fovy * Math.PI/180.0);
    var x = 1.0 / (tan*aspect);
    var y = 1.0 / (tan);
    var c = -(zfar + znear) / ( zfar - znear);
    var d = -(2.0 * zfar * znear) / (zfar - znear);

    return [ x,    0.0,  0.0,  0.0,
             0.0,  y,    0.0,  0.0,
             0.0,  0.0,  c,     d,
             0.0,  0.0, -1.0,  0.0 ];
}

function setLookAt( eye, tar, up )
{
    var dir = [ -tar[0]+eye[0], -tar[1]+eye[1], -tar[2]+eye[2] ];

	var m00 = dir[2]*up[1] - dir[1]*up[2]; 
    var m01 = dir[0]*up[2] - dir[2]*up[0];
    var m02 = dir[1]*up[0] - dir[0]*up[1];
    var im = 1.0/Math.sqrt( m00*m00 + m01*m01 + m02*m02 );
    m00 *= im;
    m01 *= im;
    m02 *= im;

	var m04 = m02*dir[1] - m01*dir[2]; 
    var m05 = m00*dir[2] - m02*dir[0];
    var m06 = m01*dir[0] - m00*dir[1];
    im = 1.0/Math.sqrt( m04*m04 + m05*m05 + m06*m06 );
    m04 *= im;
    m05 *= im;
    m06 *= im;

	var m08 = dir[0];
	var m09 = dir[1];
	var m10 = dir[2];
    im = 1.0/Math.sqrt( m08*m08 + m09*m09 + m10*m10 );
    m08 *= im;
    m09 *= im;
    m10 *= im;

	var m03 = -(m00*eye[0] + m01*eye[1] + m02*eye[2] );
	var m07 = -(m04*eye[0] + m05*eye[1] + m06*eye[2] );
	var m11 = -(m08*eye[0] + m09*eye[1] + m10*eye[2] );

    return [ m00, m01, m02, m03,
             m04, m05, m06, m07,
             m08, m09, m10, m11,
             0.0, 0.0, 0.0, 1.0 ];
}


function setOrtho( left, right, bottom, top, znear, zfar )
{
   var x = 2.0 / (right - left);
   var y = 2.0 / (top - bottom);
   var a = (right + left) / (right - left);
   var b = (top + bottom) / (top - bottom);
   var c = -2.0 / (zfar - znear);
   var d = -(zfar + znear) / ( zfar - znear);

   return [  x, 0.0, 0.0,   a,
           0.0,   y, 0.0,   b,
           0.0, 0.0,   c,   d,
           0.0, 0.0, 0.0, 1.0 ];
}

function setTranslation( p )
{
    return [ 1.0, 0.0, 0.0, p[0],
             0.0, 1.0, 0.0, p[1],
             0.0, 0.0, 1.0, p[2],
             0.0, 0.0, 0.0, 1.0 ];
}

function setScale( s )
{
    return [ s[0], 0.0,  0.0,  0.0,
             0.0,  s[1], 0.0,  0.0,
             0.0,  0.0,  s[2], 0.0,
             0.0,  0.0,  0.0,  1.0];
}

function setProjection( fov, znear, zfar )
{
    var x = 2.0 / (fov[3]+fov[2]);
    var y = 2.0 / (fov[0]+fov[1]);
    var a = (fov[3]-fov[2]) / (fov[3]+fov[2]);
    var b = (fov[0]-fov[1]) / (fov[0]+fov[1]);
    var c = -(zfar + znear) / ( zfar - znear);
    var d = -(2.0*zfar*znear) / (zfar - znear);
    return [   x, 0.0,    a, 0.0,
             0.0,   y,    b, 0.0,
             0.0, 0.0,    c,   d,
             0.0, 0.0, -1.0, 0.0 ];
   // inverse is:
   //return mat4x4( 1.0/x, 0.0f,  0.0f,   a/x,
   //               0.0f,  1.0/y, 0.0f,   b/x,
   //               0.0f,  0.0f,  0.0f,   -1.0,
   //               0.0f,  0.0f,  1.0f/d, c/d );
}


function invertFast( m )
{
    var inv = [
   
             m[5]  * m[10] * m[15] - 
             m[5]  * m[11] * m[14] - 
             m[9]  * m[6]  * m[15] + 
             m[9]  * m[7]  * m[14] +
             m[13] * m[6]  * m[11] - 
             m[13] * m[7]  * m[10],

             -m[1]  * m[10] * m[15] + 
              m[1]  * m[11] * m[14] + 
              m[9]  * m[2] * m[15] - 
              m[9]  * m[3] * m[14] - 
              m[13] * m[2] * m[11] + 
              m[13] * m[3] * m[10],

             m[1]  * m[6] * m[15] - 
             m[1]  * m[7] * m[14] - 
             m[5]  * m[2] * m[15] + 
             m[5]  * m[3] * m[14] + 
             m[13] * m[2] * m[7] - 
             m[13] * m[3] * m[6],

             -m[1] * m[6] * m[11] + 
              m[1] * m[7] * m[10] + 
              m[5] * m[2] * m[11] - 
              m[5] * m[3] * m[10] - 
              m[9] * m[2] * m[7] + 
              m[9] * m[3] * m[6],

             -m[4]  * m[10] * m[15] + 
              m[4]  * m[11] * m[14] + 
              m[8]  * m[6]  * m[15] - 
              m[8]  * m[7]  * m[14] - 
              m[12] * m[6]  * m[11] + 
              m[12] * m[7]  * m[10],

             m[0]  * m[10] * m[15] - 
             m[0]  * m[11] * m[14] - 
             m[8]  * m[2] * m[15] + 
             m[8]  * m[3] * m[14] + 
             m[12] * m[2] * m[11] - 
             m[12] * m[3] * m[10],

             -m[0]  * m[6] * m[15] + 
              m[0]  * m[7] * m[14] + 
              m[4]  * m[2] * m[15] - 
              m[4]  * m[3] * m[14] - 
              m[12] * m[2] * m[7] + 
              m[12] * m[3] * m[6],


             m[0] * m[6] * m[11] - 
             m[0] * m[7] * m[10] - 
             m[4] * m[2] * m[11] + 
             m[4] * m[3] * m[10] + 
             m[8] * m[2] * m[7] - 
             m[8] * m[3] * m[6],


             m[4]  * m[9] * m[15] - 
             m[4]  * m[11] * m[13] - 
             m[8]  * m[5] * m[15] + 
             m[8]  * m[7] * m[13] + 
             m[12] * m[5] * m[11] - 
             m[12] * m[7] * m[9],



             -m[0]  * m[9] * m[15] + 
              m[0]  * m[11] * m[13] + 
              m[8]  * m[1] * m[15] - 
              m[8]  * m[3] * m[13] - 
              m[12] * m[1] * m[11] + 
              m[12] * m[3] * m[9],

              m[0]  * m[5] * m[15] - 
              m[0]  * m[7] * m[13] - 
              m[4]  * m[1] * m[15] + 
              m[4]  * m[3] * m[13] + 
              m[12] * m[1] * m[7] - 
              m[12] * m[3] * m[5],

              -m[0] * m[5] * m[11] + 
               m[0] * m[7] * m[9] + 
               m[4] * m[1] * m[11] - 
               m[4] * m[3] * m[9] - 
               m[8] * m[1] * m[7] + 
               m[8] * m[3] * m[5],

              -m[4]  * m[9] * m[14] + 
               m[4]  * m[10] * m[13] +
               m[8]  * m[5] * m[14] - 
               m[8]  * m[6] * m[13] - 
               m[12] * m[5] * m[10] + 
               m[12] * m[6] * m[9],

              m[0]  * m[9] * m[14] - 
              m[0]  * m[10] * m[13] - 
              m[8]  * m[1] * m[14] + 
              m[8]  * m[2] * m[13] + 
              m[12] * m[1] * m[10] - 
              m[12] * m[2] * m[9],

              -m[0]  * m[5] * m[14] + 
               m[0]  * m[6] * m[13] + 
               m[4]  * m[1] * m[14] - 
               m[4]  * m[2] * m[13] - 
               m[12] * m[1] * m[6] + 
               m[12] * m[2] * m[5],

              m[0] * m[5] * m[10] - 
              m[0] * m[6] * m[9] - 
              m[4] * m[1] * m[10] + 
              m[4] * m[2] * m[9] + 
              m[8] * m[1] * m[6] - 
              m[8] * m[2] * m[5] ];

    var det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];

    det = 1.0/det;

    for( var i = 0; i<16; i++ ) inv[i] = inv[i] * det;

    return inv;
}

function matMul( a, b )
{
    var res = [];
    for( var i=0; i<4; i++ )
    {
        var x = a[4*i+0];
        var y = a[4*i+1];
        var z = a[4*i+2];
        var w = a[4*i+3];

        res[4*i+0] = x * b[ 0] + y * b[ 4] + z * b[ 8] + w * b[12];
        res[4*i+1] = x * b[ 1] + y * b[ 5] + z * b[ 9] + w * b[13];
        res[4*i+2] = x * b[ 2] + y * b[ 6] + z * b[10] + w * b[14];
        res[4*i+3] = x * b[ 3] + y * b[ 7] + z * b[11] + w * b[15];
    }

    return res;
}

function matMulpoint( m, v )
{
    return [ m[0]*v[0] + m[1]*v[1] + m[ 2]*v[2] + m[ 3],
             m[4]*v[0] + m[5]*v[1] + m[ 6]*v[2] + m[ 7],
             m[8]*v[0] + m[9]*v[1] + m[10]*v[2] + m[11] ];
}

function matMulvec( m, v )
{
    return [ m[0]*v[0] + m[1]*v[1] + m[ 2]*v[2],
             m[4]*v[0] + m[5]*v[1] + m[ 6]*v[2],
             m[8]*v[0] + m[9]*v[1] + m[10]*v[2] ];
}


function bound3( infi )
{
    return [ infi, -infi, infi, -infi, infi, -infi ];
}

function bound3_include( a, p )
{
    return [
        (p[0]<a[0]) ? p[0] : a[0],
        (p[0]>a[1]) ? p[0] : a[1],
        (p[1]<a[2]) ? p[1] : a[2],
        (p[1]>a[3]) ? p[1] : a[3],
        (p[2]<a[4]) ? p[2] : a[4],
        (p[2]>a[5]) ? p[2] : a[5] ];
}

function bound3_center( b )
{
    return [ 0.5*(b[0]+b[1]),
             0.5*(b[2]+b[3]),
             0.5*(b[4]+b[5]) ];
}

function bound3_radius( b )
{
    return [ 0.5*(b[1]-b[0]),
             0.5*(b[3]-b[2]),
             0.5*(b[5]-b[4]) ];
}
//==============================================================================
//
// piLibs 2015-2017 - http://www.iquilezles.org/www/material/piLibs/piLibs.htm
//
// piWebVR
//
//==============================================================================

function WebVR( isVREnabledCallback, canvasElement )
{
    isVREnabledCallback(false);
    /*


    this.mSupportVR = false;
    this.mHMD = null;

    var me = this;
    var listVRDisplays = function (vrdevs) {
        for (var i = 0; i < vrdevs.length; i++)
        {
            if (vrdevs[i] instanceof VRDisplay)
            {
                me.mHMD = vrdevs[i];
                console.log("WebVR is available.");
                console.log(me.mHMD);
                break;
            }
        }

        isVREnabledCallback(true);
        me.mSupportVR = true;
    }

    if (navigator.getVRDisplays)
    {
        navigator.getVRDisplays().then(listVRDisplays);
    }

    isVREnabledCallback(false);
    this.mCanvas = canvasElement;
    */
}

WebVR.prototype.IsSupported = function()
{
    return false;
    //return this.mSupportVR;
}

WebVR.prototype.GetData = function( id )
{
    return {};
    /*
    var frameData = new VRFrameData();
    var s = this.mHMD.getFrameData(frameData);
    var ss = frameData.pose;
    
    var fovL = this.mHMD.getEyeParameters("left");
    var fovR = this.mHMD.getEyeParameters( "right" );

    // camera info
    var cPos = vec3(0.0, 0.0, 0.0);
    if (ss.position)
        cPos = vec3(-ss.position[0], -ss.position[1], -ss.position[2]);
    var rot = vec4(0.0, 0.0, 0.0, 0.0);
    if (ss.orientation)
        rot = vec4(ss.orientation[0], ss.orientation[1], ss.orientation[2], ss.orientation[3]);
    var cRot = setFromQuaternion(rot);
    var cTra = setTranslation(cPos);
    var cMat = matMul(invertFast(cRot), cTra);
    
    // per eye info
    var lTra = setTranslation( vec3(-fovL.offset[0], -fovL.offset[1], -fovL.offset[2]) );
    var lMat = matMul(lTra, cMat);
    var lPrj = [ Math.tan( fovL.fieldOfView.upDegrees * Math.PI/180.0),
                 Math.tan(fovL.fieldOfView.downDegrees * Math.PI / 180.0),
                 Math.tan(fovL.fieldOfView.leftDegrees * Math.PI / 180.0),
                 Math.tan(fovL.fieldOfView.rightDegrees * Math.PI / 180.0)];

    var rTra = setTranslation(vec3(-fovR.offset[0], -fovR.offset[1], -fovR.offset[2]));
    var rMat = matMul(rTra, cMat);
    var rPrj = [Math.tan(fovR.fieldOfView.upDegrees * Math.PI / 180.0),
                 Math.tan(fovR.fieldOfView.downDegrees * Math.PI / 180.0),
                 Math.tan(fovR.fieldOfView.leftDegrees * Math.PI / 180.0),
                 Math.tan(fovR.fieldOfView.rightDegrees * Math.PI / 180.0)];

    return {
        mCamera   : { mCamera: cMat },
        mLeftEye  : { mVP:[0,0,fovL.renderWidth,fovL.renderHeight], mProjection:lPrj, mCamera:lMat },
        mRightEye : { mVP:[fovR.renderWidth/2,0,fovR.renderWidth,fovR.renderHeight], mProjection:rPrj, mCamera:rMat }
           };
    */
}

WebVR.prototype.Enable = function( id )
{
    /*
    this.mHMD.requestPresent([{ source: this.mCanvas }]).then(
        function ()
        {
        },
        function (err)
        {
            console.log("webVR : requestPresent failed.");
        }
    );
    */
}

WebVR.prototype.Disable = function( id )
{
    /*
    if (!this.mHMD.isPresenting)
    {
        return;
    }

    this.mHMD.exitPresent().then(
        function ()
        {
        },
        function (err)
        {
            console.log("webVR : exitPresent failed.");
        }
    );
    */
}

WebVR.prototype.RequestAnimationFrame = function (id)
{
    //this.mHMD.requestAnimationFrame(id);
}

WebVR.prototype.IsPresenting = function (id)
{
    /*
    if (this.mHMD.isPresenting)
    {
        return true;
    }
    */
    return false;
}

WebVR.prototype.Finish = function (id)
{
    /*
    if (this.mHMD.isPresenting)
    {
        this.mHMD.submitFrame();
    }
    */
}

//==============================================================================
//
// piLibs 2015-2017 - http://www.iquilezles.org/www/material/piLibs/piLibs.htm
//
// piWebUtils
//
//==============================================================================


// RequestAnimationFrame
window.requestAnimFrame = ( function () { return window.requestAnimationFrame    || window.webkitRequestAnimationFrame ||
                                                 window.mozRequestAnimationFrame || window.oRequestAnimationFrame ||
                                                 window.msRequestAnimationFrame  || function( cb ) { window.setTimeout(cb,1000/60); };
                                        } )();

// performance.now
window.getRealTime = ( function() { if ("performance" in window ) return function() { return window.performance.now(); }
                                                                  return function() { return (new Date()).getTime(); }
                                  } )();

window.URL = window.URL || window.webkitURL;

navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;

function htmlEntities(str) 
{
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g,'&apos;');
}

function piDisableTouch()
{
    document.body.addEventListener('touchstart', function(e){ e.preventDefault(); });
}

var piGetTime = function ( timestamp )
{
    if (timestamp == 0)
        return "";
    return new Date(timestamp * 1000).toISOString().substr(0, 10);
}

function piGetCoords( obj )
{
    var x = 0;
    var y = 0; 
    do
    {
         x += obj.offsetLeft;
         y += obj.offsetTop;
    }while( obj = obj.offsetParent );

    return { mX:x, mY:y };
}

function piGetMouseCoords( ev, canvasElement )
{
    var pos = piGetCoords(canvasElement );
    var mcx =                        (ev.pageX - pos.mX) * canvasElement.width / canvasElement.offsetWidth;
    var mcy = canvasElement.height - (ev.pageY - pos.mY) * canvasElement.height / canvasElement.offsetHeight;

    return { mX: mcx, mY: mcy };

}

function piGetSourceElement( e )
{
    var ele = null;
    if( e.target )     ele = e.target;
    if( e.srcElement ) ele = e.srcElement;
    return ele;
}

function piRequestFullScreen( ele )
{
    if( ele==null ) ele =   document.documentElement;
         if( ele.requestFullscreen       ) ele.requestFullscreen();
    else if( ele.msRequestFullscreen     ) ele.msRequestFullscreen();
    else if( ele.mozRequestFullScreen    ) ele.mozRequestFullScreen();
    else if( ele.webkitRequestFullscreen ) ele.webkitRequestFullscreen( Element.ALLOW_KEYBOARD_INPUT );
}

function piIsFullScreen()
{
    return document.fullscreen || document.mozFullScreen || document.webkitIsFullScreen || document.msFullscreenElement || false;
}

function piExitFullScreen()
{
       if( document.exitFullscreen       ) document.exitFullscreen();
  else if( document.msExitFullscreen     ) document.msExitFullscreen();
  else if( document.mozCancelFullScreen  ) document.mozCancelFullScreen();
  else if( document.webkitExitFullscreen ) document.webkitExitFullscreen();
}

function piIsMobile()
{
    return (navigator.userAgent.match(/Android/i) ||
            navigator.userAgent.match(/webOS/i) ||
            navigator.userAgent.match(/iPhone/i) ||
            navigator.userAgent.match(/iPad/i) ||
            navigator.userAgent.match(/iPod/i) ||
            navigator.userAgent.match(/BlackBerry/i) ||
            navigator.userAgent.match(/Windows Phone/i)) ? true : false;
}

function piCreateGlContext( cv, useAlpha, useDepth, usePreserveBuffer, useSupersampling )
{
    var opts = { alpha: useAlpha, 
                 depth: useDepth, 
                 stencil: false, 
                 premultipliedAlpha: false, 
                 antialias: useSupersampling, 
                 preserveDrawingBuffer: usePreserveBuffer, 
                 powerPreference: "high-performance" }; // "low_power", "high_performance", "default"

    var gl = null;
    if( gl === null) gl = cv.getContext( "webgl2", opts );
    if( gl === null) gl = cv.getContext( "experimental-webgl2", opts );
    if( gl === null) gl = cv.getContext( "webgl", opts );
    if( gl === null) gl = cv.getContext( "experimental-webgl", opts );

    return gl;
}

function piCreateAudioContext()
{
    var res = null;
    try
    {
        if( window.AudioContext ) res = new AudioContext();
        if( res==null && window.webkitAudioContext ) res = new webkitAudioContext();
    }
    catch( e )
    {
        res = null;
    }
    return res;
}

function piHexColorToRGB(str) // "#ff3041"
{
    var rgb = parseInt(str.slice(1), 16);
    var r = (rgb >> 16) & 255;
    var g = (rgb >> 8) & 255;
    var b = (rgb >> 0) & 255;
    return [r, g, b];
}

function piCreateFPSCounter()
{
    var mFrame;
    var mTo;
    var mFPS;

    var iReset = function( time )
    {
        mFrame = 0;
        mTo = time;
        mFPS = 60.0;
    }

    var iCount = function( time )
    {
        mFrame++;

        if( (time-mTo)>500.0 )
        {
            mFPS = 1000.0*mFrame/(time-mTo);
            mFrame = 0;
            mTo = time;
            return true;
        }
        return false;
    }

    var iGetFPS = function()
    {
        return mFPS;
    }
    
    return { Reset : iReset, Count : iCount, GetFPS : iGetFPS };
}

function piCanMediaRecorded(canvas)
{
    if (typeof window.MediaRecorder !== 'function' || typeof canvas.captureStream !== 'function') {
        return false;
    }
    return true;
}

function piCreateMediaRecorder(isRecordingCallback, canvas) 
{
    if (piCanMediaRecorded(canvas) == false)
    {
        return null;
    }
    
    var options = { audioBitsPerSecond : 0, videoBitsPerSecond : 8000000 }; 
	     if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) options.mimeType = 'video/webm;codecs=h264';
    else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9' )) options.mimeType = 'video/webm;codecs=vp9';
    else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8' )) options.mimeType = 'video/webm;codecs=vp8';
    else                                                              options.mimeType = 'video/webm;';

    var mediaRecorder = new MediaRecorder(canvas.captureStream(), options);
    var chunks = [];
    
    mediaRecorder.ondataavailable = function(e) 
    {
        if (e.data.size > 0) 
        {
            chunks.push(e.data);
        }
    };
 
    mediaRecorder.onstart = function(){ 
        isRecordingCallback( true );
    };
    
    mediaRecorder.onstop = function()
    {
         isRecordingCallback( false );
         let blob     = new Blob(chunks, {type: "video/webm"});
         chunks       = [];
         let videoURL = window.URL.createObjectURL(blob);
         let url      = window.URL.createObjectURL(blob);
         let a        = document.createElement("a");
         document.body.appendChild(a);
         a.style      = "display: none";
         a.href       = url;
         a.download   = "capture.webm";
         a.click();
         window.URL.revokeObjectURL(url);
     };
    
    return mediaRecorder;
}

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
    return new Blob([buffer], {type: 'application/octet-stream'});
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

function piTriggerDownload(name, blob)
{
    let url = URL.createObjectURL(blob);
    let aElement = document.createElement("a");
    aElement.href     = url;
    aElement.target   = "_self";
    aElement.download = name;
    document.body.appendChild(aElement);
    aElement.click();
    document.body.removeChild(aElement);
}</script>
    <script>"use strict"

function bufferID_to_assetID( id )
{
    if( id===0 ) return '4dXGR8';
    if( id===1 ) return 'XsXGR8';
    if( id===2 ) return '4sXGR8';
    if( id===3 ) return 'XdfGR8';
    return 'none';
}
function assetID_to_bufferID( id )
{
    if( id==='4dXGR8' ) return 0;
    if( id==='XsXGR8' ) return 1;
    if( id==='4sXGR8' ) return 2;
    if( id==='XdfGR8' ) return 3;
    return -1;
}

function assetID_to_cubemapBuferID( id )
{
    if( id==='4dX3Rr' ) return 0;
    return -1;
}
function cubamepBufferID_to_assetID( id )
{
    if( id===0 ) return '4dX3Rr';
    return 'none';
}

function EffectPass( renderer, is20, isLowEnd, hasShaderTextureLOD, callback, obj, forceMuted, forcePaused, outputGainNode, copyProgram, id, effect  )
{
    this.mID = id;
    this.mInputs  = [null, null, null, null ];
    this.mOutputs = [null, null, null, null ];
    this.mSource = null;

    this.mGainNode = outputGainNode;
    this.mSoundShaderCompiled = false;

    this.mEffect = effect;
    this.mRenderer = renderer;
    this.mProgramCopy = copyProgram; 
    this.mCompilationTime = 0;

    this.mType = "none";
    this.mName = "none";
    this.mFrame = 0;

    this.mShaderTextureLOD = hasShaderTextureLOD;
    this.mIs20 = is20;
    this.mIsLowEnd = isLowEnd;
    this.mTextureCallbackFun = callback;
    this.mTextureCallbackObj = obj;
    this.mForceMuted = forceMuted;
    this.mForcePaused = forcePaused;
}

EffectPass.prototype.MakeHeader_Image = function()
{
    let header = "";

    header += "#define HW_PERFORMANCE " + ((this.mIsLowEnd===true)?"0":"1") + "\n";

    header += "uniform vec3      iResolution;\n" +
              "uniform float     iTime;\n" +
              "uniform float     iChannelTime[4];\n" +
              "uniform vec4      iMouse;\n" +
              "uniform vec4      iDate;\n" +
              "uniform float     iSampleRate;\n" +
              "uniform vec3      iChannelResolution[4];\n" +
              "uniform int       iFrame;\n" +
              "uniform float     iTimeDelta;\n" +
              "uniform float     iFrameRate;\n";

    for( let i=0; i<this.mInputs.length; i++ )
    {
        let inp = this.mInputs[i];

        // old API
             if( inp===null )                  header += "uniform sampler2D iChannel" + i + ";\n";
        else if( inp.mInfo.mType==="cubemap" ) header += "uniform samplerCube iChannel" + i + ";\n";
        else if( inp.mInfo.mType==="volume"  ) header += "uniform sampler3D iChannel" + i + ";\n";
        else                                   header += "uniform sampler2D iChannel" + i + ";\n";

        // new API (see shadertoy.com/view/wtdGW8)
        header += "uniform struct {\n";
             if( inp===null )                  header += "  sampler2D";
        else if( inp.mInfo.mType==="cubemap" ) header += "  samplerCube";
        else if( inp.mInfo.mType==="volume"  ) header += "  sampler3D";
        else                                  header += "  sampler2D";
        header +=        " sampler;\n";
        header += "  vec3  size;\n";
        header += "  float time;\n";
        header += "  int   loaded;\n";
        header += "}iCh" + i + ";\n";
    }
	header += "void mainImage( out vec4 c, in vec2 f );\n";
    header += "void st_assert( bool cond );\n";
    header += "void st_assert( bool cond, int v );\n";

    if( this.mIs20 ) 
    {
        header += "\nout vec4 shadertoy_out_color;\n" +
        "void st_assert( bool cond, int v ) {if(!cond){if(v==0)shadertoy_out_color.x=-1.0;else if(v==1)shadertoy_out_color.y=-1.0;else if(v==2)shadertoy_out_color.z=-1.0;else shadertoy_out_color.w=-1.0;}}\n" +
        "void st_assert( bool cond        ) {if(!cond)shadertoy_out_color.x=-1.0;}\n" +
        "void main( void )" +
        "{" +
            "shadertoy_out_color = vec4(1.0,1.0,1.0,1.0);" + 
            "vec4 color = vec4(1e20);" +
            "mainImage( color, gl_FragCoord.xy );" +
            "if(shadertoy_out_color.x<0.0) color=vec4(1.0,0.0,0.0,1.0);" +
            "if(shadertoy_out_color.y<0.0) color=vec4(0.0,1.0,0.0,1.0);" +
            "if(shadertoy_out_color.z<0.0) color=vec4(0.0,0.0,1.0,1.0);" +
            "if(shadertoy_out_color.w<0.0) color=vec4(1.0,1.0,0.0,1.0);" +
            "shadertoy_out_color = vec4(color.xyz,1.0);" +
        "}";
    }
    else
    {
        header += "" +
        "void st_assert( bool cond, int v ) {if(!cond){if(v==0)gl_FragColor.x=-1.0;else if(v==1)gl_FragColor.y=-1.0;else if(v==2)gl_FragColor.z=-1.0;else gl_FragColor.w=-1.0;}}\n" +
        "void st_assert( bool cond        ) {if(!cond)gl_FragColor.x=-1.0;}\n" +
        "void main( void )" +
        "{" +
            "gl_FragColor = vec4(0.0,0.0,0.0,1.0);" + 
            "vec4 color = vec4(1e20);" +
            "mainImage( color, gl_FragCoord.xy );" +
            "color.w = 1.0;" +
            "if(gl_FragColor.w<0.0) color=vec4(1.0,0.0,0.0,1.0);" +
            "if(gl_FragColor.x<0.0) color=vec4(1.0,0.0,0.0,1.0);" +
            "if(gl_FragColor.y<0.0) color=vec4(0.0,1.0,0.0,1.0);" +
            "if(gl_FragColor.z<0.0) color=vec4(0.0,0.0,1.0,1.0);" +
            "if(gl_FragColor.w<0.0) color=vec4(1.0,1.0,0.0,1.0);" +
            "gl_FragColor = vec4(color.xyz,1.0);"+
        "}";
    }
    header += "\n";

    /*
    this.mImagePassFooterVR = "\n" +
    "uniform vec4 unViewport;\n" +
    "uniform vec3 unCorners[5];\n";
    if( this.mIs20 ) 
        this.mImagePassFooterVR += "\nout vec4 outColor;\n";
    this.mImagePassFooterVR += "void main( void )" +
    "{" +
        "vec4 color = vec4(1e20);" +

        "vec3 ro = unCorners[4];" +
        "vec2 uv = (gl_FragCoord.xy - unViewport.xy)/unViewport.zw;" + 
        "vec3 rd = normalize( mix( mix( unCorners[0], unCorners[1], uv.x )," +
                                  "mix( unCorners[3], unCorners[2], uv.x ), uv.y ) - ro);" + 

        "mainVR( color, gl_FragCoord.xy-unViewport.xy, ro, rd );" +
        "color.w = 1.0;"
    if( this.mIs20 ) 
        this.mImagePassFooterVR +=  "outColor = color;}";
    else
        this.mImagePassFooterVR +=  "gl_FragColor = color;}";
    */
    this.mHeader = header;
    this.mHeaderLength = 0;
}

EffectPass.prototype.MakeHeader_Buffer = function()
{
    let header = "";
    
    header += "#define HW_PERFORMANCE " + ((this.mIsLowEnd===true)?"0":"1") + "\n";

    header += "uniform vec3      iResolution;\n" +
              "uniform float     iTime;\n" +
              "uniform float     iChannelTime[4];\n" +
              "uniform vec4      iMouse;\n" +
              "uniform vec4      iDate;\n" +
              "uniform float     iSampleRate;\n" +
              "uniform vec3      iChannelResolution[4];\n" +
              "uniform int       iFrame;\n" +
              "uniform float     iTimeDelta;\n" +
              "uniform float     iFrameRate;\n";

    for (let i = 0; i < this.mInputs.length; i++)
    {
        let inp = this.mInputs[i];
             if( inp===null )                  header += "uniform sampler2D iChannel" + i + ";\n";
        else if( inp.mInfo.mType==="cubemap" ) header += "uniform samplerCube iChannel" + i + ";\n";
        else if( inp.mInfo.mType==="volume"  ) header += "uniform sampler3D iChannel" + i + ";\n";
        else                                  header += "uniform sampler2D iChannel" + i + ";\n";
    }

	header += "void mainImage( out vec4 c,  in vec2 f );\n"

    if( this.mIs20 )
        header += "\nout vec4 outColor;\n";
    header += "\nvoid main( void )\n" +
    "{" +
        "vec4 color = vec4(1e20);" +
        "mainImage( color, gl_FragCoord.xy );";
    if( this.mIs20 )
        header +="outColor = color; }";
    else
        header +="gl_FragColor = color; }";
    header += "\n";

    /*
    this.mImagePassFooterVR = "\n" +
    "uniform vec4 unViewport;\n" +
    "uniform vec3 unCorners[5];\n";
    if( this.mIs20 )
    this.mImagePassFooterVR += "\nout vec4 outColor;\n";
    this.mImagePassFooterVR += "\nvoid main( void )\n" +
    "{" +
        "vec4 color = vec4(1e20);" +

        "vec3 ro = unCorners[4];" +
        "vec2 uv = (gl_FragCoord.xy - unViewport.xy)/unViewport.zw;" + 
        "vec3 rd = normalize( mix( mix( unCorners[0], unCorners[1], uv.x )," +
                                  "mix( unCorners[3], unCorners[2], uv.x ), uv.y ) - ro);" + 

        "mainVR( color, gl_FragCoord.xy-unViewport.xy, ro, rd );";
    if( this.mIs20 )
        this.mImagePassFooterVR +="outColor = color; }";
    else
        this.mImagePassFooterVR +="gl_FragColor = color; }";
    */
    this.mHeader = header;
    this.mHeaderLength = 0;
}

EffectPass.prototype.MakeHeader_Cubemap = function()
{
    let header = "";
    
    header += "#define HW_PERFORMANCE " + ((this.mIsLowEnd===true)?"0":"1") + "\n";

    header += "uniform vec3      iResolution;\n" +
              "uniform float     iTime;\n" +
              "uniform float     iChannelTime[4];\n" +
              "uniform vec4      iMouse;\n" +
              "uniform vec4      iDate;\n" +
              "uniform float     iSampleRate;\n" +
              "uniform vec3      iChannelResolution[4];\n" +
              "uniform int       iFrame;\n" +
              "uniform float     iTimeDelta;\n" +
              "uniform float     iFrameRate;\n";

    for (let i = 0; i < this.mInputs.length; i++)
    {
        let inp = this.mInputs[i];
             if( inp===null )                  header += "uniform sampler2D iChannel" + i + ";\n";
        else if( inp.mInfo.mType==="cubemap" ) header += "uniform samplerCube iChannel" + i + ";\n";
        else if( inp.mInfo.mType==="volume"  ) header += "uniform sampler3D iChannel" + i + ";\n";
        else                                   header += "uniform sampler2D iChannel" + i + ";\n";
    }

	header += "void mainCubemap( out vec4 c, in vec2 f, in vec3 ro, in vec3 rd );\n"

    header += "\n" +
    "uniform vec4 unViewport;\n" +
    "uniform vec3 unCorners[5];\n";
    if( this.mIs20 )
        header += "\nout vec4 outColor;\n";
    header += "\nvoid main( void )\n" +
    "{" +
        "vec4 color = vec4(1e20);" +

        "vec3 ro = unCorners[4];" +
        "vec2 uv = (gl_FragCoord.xy - unViewport.xy)/unViewport.zw;" + 
        "vec3 rd = normalize( mix( mix( unCorners[0], unCorners[1], uv.x )," +
                                  "mix( unCorners[3], unCorners[2], uv.x ), uv.y ) - ro);" + 

        "mainCubemap( color, gl_FragCoord.xy-unViewport.xy, ro, rd );";
    if( this.mIs20 )
        header +="outColor = color; }";
    else
        header +="gl_FragColor = color; }";
    header += "\n";

    this.mHeader = header;
    this.mHeaderLength = 0;
}

EffectPass.prototype.MakeHeader_Sound = function()
{
    let header = "";

    header += "#define HW_PERFORMANCE " + ((this.mIsLowEnd===true)?"0":"1") + "\n";

    header += "uniform float     iChannelTime[4];\n" +
              "uniform float     iTimeOffset;\n" +
              "uniform int       iSampleOffset;\n" +
              "uniform vec4      iDate;\n" +
              "uniform float     iSampleRate;\n" +
              "uniform vec3      iChannelResolution[4];\n";

    for (let i=0; i<this.mInputs.length; i++ )
    {
        let inp = this.mInputs[i];

        if( inp!==null && inp.mInfo.mType==="cubemap" )
            header += "uniform samplerCube iChannel" + i + ";\n";
        else
            header += "uniform sampler2D iChannel" + i + ";\n";
    }
    header += "\n";
    header += "vec2 mainSound( in int samp, float time );\n";

    if( this.mIs20 )
    {
        header += "out vec4 outColor; void main()" +
            "{" +
            "float t = iTimeOffset + ((gl_FragCoord.x-0.5) + (gl_FragCoord.y-0.5)*512.0)/iSampleRate;" +
            "int   s = iSampleOffset + int(gl_FragCoord.y-0.2)*512 + int(gl_FragCoord.x-0.2);" +
            "vec2 y = mainSound( s, t );" +
            "vec2 v  = floor((0.5+0.5*y)*65536.0);" +
            "vec2 vl =   mod(v,256.0)/255.0;" +
            "vec2 vh = floor(v/256.0)/255.0;" +
            "outColor = vec4(vl.x,vh.x,vl.y,vh.y);" +
            "}";
    }
    else
    {
        header += "void main()" +
            "{" +
            "float t = iTimeOffset + ((gl_FragCoord.x-0.5) + (gl_FragCoord.y-0.5)*512.0)/iSampleRate;" +
            "vec2 y = mainSound( 0, t );" +
            "vec2 v  = floor((0.5+0.5*y)*65536.0);" +
            "vec2 vl =   mod(v,256.0)/255.0;" +
            "vec2 vh = floor(v/256.0)/255.0;" +
            "gl_FragColor = vec4(vl.x,vh.x,vl.y,vh.y);" +
            "}";
    }
    header += "\n";
    this.mHeader = header;
    this.mHeaderLength = 0;
}


EffectPass.prototype.MakeHeader_Common = function ()
{
    let header = "";
    let headerlength = 0;

    header += "uniform vec4      iDate;\n" +
              "uniform float     iSampleRate;\n";
    headerlength += 2;

    if (this.mIs20)
    {
        header += "out vec4 outColor;\n";
        headerlength += 1;
    }
    header += "void main( void )\n";
    headerlength += 1;

    if (this.mIs20)
        header += "{ outColor = vec4(0.0); }";
    else
        header += "{ gl_FragColor = vec4(0.0); }";
    headerlength += 1;
    header += "\n";
    headerlength += 1;

    this.mHeader = header;
    this.mHeaderLength = headerlength;
}

EffectPass.prototype.MakeHeader = function()
{
         if( this.mType==="image" ) this.MakeHeader_Image();
    else if( this.mType==="sound" ) this.MakeHeader_Sound();
    else if( this.mType==="buffer") this.MakeHeader_Buffer();
    else if( this.mType==="common") this.MakeHeader_Common();
    else if( this.mType==="cubemap") this.MakeHeader_Cubemap();
    else console.log("ERROR 4");
}

EffectPass.prototype.Create_Image = function( wa )
{
    this.MakeHeader();
    this.mSampleRate = 44100;
    this.mSupportsVR = false;
    this.mProgram = null;
    this.mError = false;
    this.mErrorStr = "";
    this.mTranslatedSource = null;
    //this.mProgramVR = null;
}
EffectPass.prototype.Destroy_Image = function( wa )
{
}

EffectPass.prototype.Create_Buffer = function( wa )
{
    this.MakeHeader();
    this.mSampleRate = 44100;
    this.mSupportsVR = false;
    this.mProgram = null;
    this.mError = false;
    this.mErrorStr = "";
    this.mTranslatedSource = null;
    //this.mProgramVR = null;
}

EffectPass.prototype.Destroy_Buffer = function( wa )
{
}

EffectPass.prototype.Create_Cubemap = function( wa )
{
    this.MakeHeader();
    this.mSampleRate = 44100;
    this.mProgram = null;
    this.mError = false;
    this.mErrorStr = "";
    this.mTranslatedSource = null;
}

EffectPass.prototype.Destroy_Cubemap = function( wa )
{
}

EffectPass.prototype.Create_Common = function( wa )
{
    this.mProgram = null;
    this.mError = false;
    this.mErrorStr = "";
    this.MakeHeader();
}
EffectPass.prototype.Destroy_Common = function( wa )
{
}

EffectPass.prototype.Create_Sound = function (wa)
{
    this.MakeHeader();

    this.mProgram = null;
    this.mError = false;
    this.mErrorStr = "";
    this.mTranslatedSource = null;
    this.mSampleRate = 44100;
    this.mPlayTime = 60*3;
    this.mPlaySamples = this.mPlayTime*this.mSampleRate;
    this.mBuffer = wa.createBuffer( 2, this.mPlaySamples, this.mSampleRate );

    //-------------------
    this.mTextureDimensions = 512;
    this.mRenderTexture = this.mRenderer.CreateTexture(this.mRenderer.TEXTYPE.T2D, 
                                                       this.mTextureDimensions, this.mTextureDimensions,
                                                       this.mRenderer.TEXFMT.C4I8,
                                                       this.mRenderer.FILTER.NONE,
                                                       this.mRenderer.TEXWRP.CLAMP, null);
    this.mRenderFBO = this.mRenderer.CreateRenderTarget(this.mRenderTexture, null, null, null, null, false);

    //-----------------------------

    // ArrayBufferView pixels;
    this.mTmpBufferSamples = this.mTextureDimensions*this.mTextureDimensions;
    this.mData = new Uint8Array( this.mTmpBufferSamples*4 );

    this.mPlaying = false;
}

EffectPass.prototype.Destroy_Sound = function( wa )
{
    if( this.mPlayNode!==null ) this.mPlayNode.stop();
    this.mPlayNode = null;
    this.mBuffer = null;
    this.mData = null;

    this.mRenderer.DestroyRenderTarget(this.mRenderFBO);
    this.mRenderer.DestroyTexture(this.mRenderTexture);
}

EffectPass.prototype.Create = function( passType, wa )
{
    this.mType = passType;
    this.mSource = null;

         if( passType==="image" ) this.Create_Image( wa );
    else if( passType==="sound" ) this.Create_Sound( wa );
    else if( passType==="buffer") this.Create_Buffer( wa );
    else if( passType==="common") this.Create_Common( wa );
    else if( passType==="cubemap") this.Create_Cubemap( wa );
    else alert("ERROR 1");
}

EffectPass.prototype.SetName = function (passName)
{
    this.mName = passName;
}

EffectPass.prototype.SetCode = function (src)
{
    this.mSource = src;
}

EffectPass.prototype.Destroy = function( wa )
{
    this.mSource = null;
         if( this.mType==="image" ) this.Destroy_Image( wa );
    else if( this.mType==="sound" ) this.Destroy_Sound( wa );
    else if( this.mType==="buffer") this.Destroy_Buffer( wa );
    else if( this.mType==="common") this.Destroy_Common( wa );
    else if( this.mType==="cubemap") this.Destroy_Cubemap( wa );
    else alert("ERROR 2");
}

EffectPass.prototype.NewShader_Sound = function( shaderCode, commonShaderCodes)
{
    let vsSource = null;

    if( this.mIs20 )
        vsSource = "layout(location = 0) in vec2 pos; void main() { gl_Position = vec4(pos.xy,0.0,1.0); }";
    else
        vsSource = "attribute vec2 pos; void main() { gl_Position = vec4(pos.xy,0.0,1.0); }";

    let fsSource = this.mHeader;
    for( let i=0; i<commonShaderCodes.length; i++ )
    {
        fsSource += commonShaderCodes[i]+'\n';
    }
    this.mHeaderLength = fsSource.split(/\r\n|\r|\n/).length;
    fsSource += shaderCode;

    this.mSoundShaderCompiled = false;

    return [vsSource, fsSource];
}

EffectPass.prototype.NewShader_Image = function ( shaderCode, commonShaderCodes )
{
    this.mSupportsVR = false;

    let vsSource = null;
    if( this.mIs20 )
        vsSource = "layout(location = 0) in vec2 pos; void main() { gl_Position = vec4(pos.xy,0.0,1.0); }";
    else
        vsSource = "attribute vec2 pos; void main() { gl_Position = vec4(pos.xy,0.0,1.0); }";

    let fsSource = this.mHeader;
    for (let i = 0; i < commonShaderCodes.length; i++)
    {
        fsSource += commonShaderCodes[i]+'\n';
    }
    this.mHeaderLength = fsSource.split(/\r\n|\r|\n/).length;
    fsSource += shaderCode;

    return [vsSource, fsSource];


    /*
    let n1 = shaderCode.indexOf("mainVR(");
    let n2 = shaderCode.indexOf("mainVR (");
    let n3 = shaderCode.indexOf("mainVR  (");
    if( n1>0 || n2>0 || n3>0 )
    {
        let vsSourceVR;
        if( this.mIs20 )
            vsSourceVR = "layout(location = 0) in vec2 pos; void main() { gl_Position = vec4(pos.xy,0.0,1.0); }";
        else
            vsSourceVR = "attribute in vec2 pos; void main() { gl_Position = vec4(pos.xy,0.0,1.0); }";

        let fsSourceVR = this.mHeader;
        for (let i = 0; i < commonShaderCodes.length; i++) {
            fsSourceVR += commonShaderCodes[i];
        }
        fsSourceVR += shaderCode;
        fsSourceVR += this.mImagePassFooterVR;

        let res = this.mRenderer.CreateShader(vsSource, fsSourceVR, preventCache);
        if( res.mResult == false )
        {
            return res.mInfo;
        }
        if( this.mProgramVR != null )
            this.mRenderer.DestroyShader( this.mProgramVR );

        this.mSupportsVR = true;
        this.mProgramVR = res;
    }
    */
}

EffectPass.prototype.NewShader_Cubemap = function( shaderCode, commonShaderCodes )
{
    let vsSource = null;
    if( this.mIs20 )
        vsSource = "layout(location = 0) in vec2 pos; void main() { gl_Position = vec4(pos.xy,0.0,1.0); }";
    else
        vsSource = "attribute vec2 pos; void main() { gl_Position = vec4(pos.xy,0.0,1.0); }";

    let fsSource = this.mHeader;
    for (let i = 0; i < commonShaderCodes.length; i++)
    {
        fsSource += commonShaderCodes[i]+'\n';
    }

    this.mHeaderLength = fsSource.split(/\r\n|\r|\n/).length;

    fsSource += shaderCode;

    return [vsSource, fsSource];
}

EffectPass.prototype.NewShader_Common = function (shaderCode )
{
    let vsSource = null;
    if (this.mIs20)
        vsSource = "layout(location = 0) in vec2 pos; void main() { gl_Position = vec4(pos.xy,0.0,1.0); }";
    else
        vsSource = "attribute vec2 pos; void main() { gl_Position = vec4(pos.xy,0.0,1.0); }";

    let fsSource = this.mHeader + shaderCode;

    return [vsSource, fsSource];
}

EffectPass.prototype.NewShader = function ( commonSourceCodes, preventCache, onResolve)
{
    if( this.mRenderer===null ) return;

    let vs_fs = null;

         if( this.mType==="sound"  ) vs_fs = this.NewShader_Sound(   this.mSource, commonSourceCodes );
    else if( this.mType==="image"  ) vs_fs = this.NewShader_Image(   this.mSource, commonSourceCodes );
    else if( this.mType==="buffer" ) vs_fs = this.NewShader_Image(   this.mSource, commonSourceCodes );
    else if( this.mType==="common" ) vs_fs = this.NewShader_Common(  this.mSource,                   );
    else if( this.mType==="cubemap") vs_fs = this.NewShader_Cubemap( this.mSource, commonSourceCodes );
    else { console.log("ERROR 3: \"" + this.mType + "\""); return; }

    let me = this;
    this.mRenderer.CreateShader(vs_fs[0], vs_fs[1], preventCache, false,
        function (worked, info)
        {
            if (worked === true)
            {
                if (me.mType === "sound")
                {
                    me.mSoundShaderCompiled = true;
                }

                me.mCompilationTime = info.mTime;
                me.mError = false;
                me.mErrorStr = "No Errors";
                if (me.mProgram !== null)
                    me.mRenderer.DestroyShader(me.mProgram);
                me.mTranslatedSource = me.mRenderer.GetTranslatedShaderSource(info);
                me.mProgram = info;
            }
            else
            {
                me.mError = true;
                me.mErrorStr = info.mErrorStr;
            }
            onResolve();
        });
}

EffectPass.prototype.DestroyInput = function( id )
{
    if( this.mInputs[id]===null ) return;

    if( this.mInputs[id].mInfo.mType==="texture" )
    {
        if( this.mInputs[id].globject !== null )
            this.mRenderer.DestroyTexture(this.mInputs[id].globject);
    }
    if( this.mInputs[id].mInfo.mType==="volume" )
    {
        if( this.mInputs[id].globject !== null )
            this.mRenderer.DestroyTexture(this.mInputs[id].globject);
    }
    else if( this.mInputs[id].mInfo.mType==="webcam" )
    {
        this.mInputs[id].video.pause();
        this.mInputs[id].video.src = "";

        if( this.mInputs[id].video.srcObject!==null )
        {
        let tracks = this.mInputs[id].video.srcObject.getVideoTracks();
        if( tracks ) tracks[0].stop();
        }
        this.mInputs[id].video = null;
        if( this.mInputs[id].globject !== null )
            this.mRenderer.DestroyTexture(this.mInputs[id].globject);
    }
    else if( this.mInputs[id].mInfo.mType==="video" )
    {
        this.mInputs[id].video.pause();
        this.mInputs[id].video = null;
        if( this.mInputs[id].globject !== null )
            this.mRenderer.DestroyTexture(this.mInputs[id].globject);
    }
    else if( this.mInputs[id].mInfo.mType==="music" || this.mInputs[id].mInfo.mType==="musicstream")
    {
        this.mInputs[id].audio.pause();
        this.mInputs[id].audio.mSound.mFreqData = null;
        this.mInputs[id].audio.mSound.mWaveData = null;
        this.mInputs[id].audio = null;
        if( this.mInputs[id].globject !== null )
            this.mRenderer.DestroyTexture(this.mInputs[id].globject);
    }
    else if( this.mInputs[id].mInfo.mType==="cubemap" )
    {
        if( this.mInputs[id].globject !== null )
            this.mRenderer.DestroyTexture(this.mInputs[id].globject);
    }
    else if( this.mInputs[id].mInfo.mType==="keyboard" )
    {
        //if( this.mInputs[id].globject != null )
          //  this.mRenderer.DestroyTexture(this.mInputs[id].globject);
    }
    else if( this.mInputs[id].mInfo.mType==="mic" )
    {
        this.mInputs[id].mic = null;
        if( this.mInputs[id].globject !== null )
            this.mRenderer.DestroyTexture(this.mInputs[id].globject);
    }

    this.mInputs[id] = null;
}

EffectPass.prototype.TooglePauseInput = function( wa, id )
{
    var me = this;
    let inp = this.mInputs[id];

    if( inp===null )
    {
    }
    else if( inp.mInfo.mType==="texture" )
    {
    }
    else if( inp.mInfo.mType==="volume" )
    {
    }
    else if( inp.mInfo.mType==="video" )
    {
        if( inp.video.mPaused )
        {
            inp.video.play();
            inp.video.mPaused = false;
        }
        else
        {
            inp.video.pause();
            inp.video.mPaused = true;
        }
        return inp.video.mPaused;
    }
    else if( inp.mInfo.mType==="music" || inp.mInfo.mType==="musicstream")
    {
        wa.resume()
        if( inp.audio.mPaused )
        {
            if( inp.loaded )
            {
                inp.audio.play();
            }
            inp.audio.mPaused = false;
        }
        else
        {
            inp.audio.pause();
            inp.audio.mPaused = true;
        }
        return inp.audio.mPaused;
    }

    return null;
}

EffectPass.prototype.StopInput = function( id )
{
    let inp = this.mInputs[id];

    if( inp===null )
    {
    }
    else if( inp.mInfo.mType==="texture" )
    {
    }
    else if( inp.mInfo.mType==="volume" )
    {
    }
    else if( inp.mInfo.mType==="video" )
    {
        if( inp.video.mPaused === false )
        {
            inp.video.pause();
            inp.video.mPaused = true;
        }
        return inp.video.mPaused;
    }
    else if( inp.mInfo.mType==="music" || inp.mInfo.mType==="musicstream" )
    {
        if( inp.audio.mPaused === false )
        {
            inp.audio.pause();
            inp.audio.mPaused = true;
        }
        return inp.audio.mPaused;
    }
    return null;
}

EffectPass.prototype.ResumeInput = function( id )
{
    let inp = this.mInputs[id];

    if( inp===null )
    {
    }
    else if( inp.mInfo.mType==="texture" )
    {
    }
    else if( inp.mInfo.mType==="volume" )
    {
    }
    else if( inp.mInfo.mType==="video" )
    {
        if( inp.video.mPaused )
        {
            inp.video.play();
            inp.video.mPaused = false;
        }
        return inp.video.mPaused;
    }
    else if( inp.mInfo.mType==="music" || inp.mInfo.mType==="musicstream" )
    {
        if( inp.audio.mPaused )
        {
            inp.audio.play();
            inp.audio.mPaused = false;
        }
        return inp.audio.mPaused;
    }
    return null;
}

EffectPass.prototype.RewindInput = function( wa, id )
{
    var me = this;
    let inp = this.mInputs[id];

    if( inp==null )
    {
    }
    else if( inp.mInfo.mType==="texture" )
    {
    }
    else if( inp.mInfo.mType==="volume" )
    {
    }
    else if( inp.mInfo.mType==="video" )
    {
        if( inp.loaded )
        {
            inp.video.currentTime = 0;
        }
    }
    else if( inp.mInfo.mType==="music" || inp.mInfo.mType==="musicstream")
    {
        wa.resume()
        if( inp.loaded )
        {
            inp.audio.currentTime = 0;
        }
    }
}

EffectPass.prototype.MuteInput = function( wa, id )
{
    let inp = this.mInputs[id];
    if( inp===null ) return;

    if( inp.mInfo.mType==="video" )
    {
        inp.video.muted = true;
        inp.video.mMuted = true;
    }
    else if( inp.mInfo.mType==="music" || inp.mInfo.mType==="musicstream")
    {
        if (wa !== null) inp.audio.mSound.mGain.gain.value = 0.0;
        inp.audio.mMuted = true;
    }
}

EffectPass.prototype.UnMuteInput = function( wa, id )
{
    let inp = this.mInputs[id];
    if( inp===null ) return;

    if( inp.mInfo.mType==="video" )
    {
        inp.video.muted = false;
        inp.video.mMuted = false;
    }
    else if( inp.mInfo.mType==="music" || inp.mInfo.mType==="musicstream")
    {
        if (wa !== null) inp.audio.mSound.mGain.gain.value = 1.0;
        inp.audio.mMuted = false;
    }
}

EffectPass.prototype.ToggleMuteInput = function( wa, id )
{
    var me = this;
    let inp = this.mInputs[id];
    if( inp===null ) return null;

    if( inp.mInfo.mType==="video" )
    {
        if( inp.video.mMuted ) this.UnMuteInput(wa,id);
        else                   this.MuteInput(wa,id);
        return inp.video.mMuted;
    }
    else if( inp.mInfo.mType==="music" || inp.mInfo.mType==="musicstream")
    {
        if( inp.audio.mMuted ) this.UnMuteInput(wa,id);
        else                   this.MuteInput(wa,id);
        return inp.audio.mMuted;
    }

    return null;
}

EffectPass.prototype.UpdateInputs = function( wa, forceUpdate, keyboard )
{
   for (let i=0; i<this.mInputs.length; i++ )
   {
        let inp = this.mInputs[i];

        if( inp===null )
        {
            if( forceUpdate )
            {
              if( this.mTextureCallbackFun!==null )
                  this.mTextureCallbackFun( this.mTextureCallbackObj, i, null, false, 0, 0, -1.0, this.mID );
            }
        }
        else if( inp.mInfo.mType==="texture" )
        {
            if( inp.loaded && forceUpdate )
            {
              if( this.mTextureCallbackFun!==null )
                  this.mTextureCallbackFun( this.mTextureCallbackObj, i, inp.image, true, 1, 1, -1.0, this.mID );
            }
        }
        else if( inp.mInfo.mType==="volume" )
        {
            if( inp.loaded && forceUpdate )
            {
              if( this.mTextureCallbackFun!==null )
                  this.mTextureCallbackFun( this.mTextureCallbackObj, i, inp.mPreview, true, 1, 1, -1.0, this.mID );
            }
        }
        else if( inp.mInfo.mType==="cubemap" )
        {
            if( inp.loaded && forceUpdate )
            {
                if( this.mTextureCallbackFun!==null )
                {
                    let img = (assetID_to_cubemapBuferID(inp.mInfo.mID)===-1) ? inp.image[0] : inp.mImage;
                    this.mTextureCallbackFun( this.mTextureCallbackObj, i, img, true, 2, 1, -1.0, this.mID );
                }
            }
        }
        else if( inp.mInfo.mType==="keyboard" )
        {
            if( this.mTextureCallbackFun!==null )
                this.mTextureCallbackFun( this.mTextureCallbackObj, i, {mImage:keyboard.mIcon,mData:keyboard.mData}, false, 6, 0, -1.0, this.mID );
        }
        else if( inp.mInfo.mType==="video" )
        {
            if( inp.video.readyState === inp.video.HAVE_ENOUGH_DATA )
            {
                if( this.mTextureCallbackFun!==null )
                    this.mTextureCallbackFun( this.mTextureCallbackObj, i, inp.video, false, 3, 1, -1, this.mID );
            }
        }
        else if( inp.mInfo.mType==="music" || inp.mInfo.mType==="musicstream" )
        {
              if( inp.loaded && inp.audio.mPaused === false && inp.audio.mForceMuted === false )
              {
                  if( wa !== null )
                  {
                      inp.audio.mSound.mAnalyser.getByteFrequencyData(  inp.audio.mSound.mFreqData );
                      inp.audio.mSound.mAnalyser.getByteTimeDomainData( inp.audio.mSound.mWaveData );
                  }

                  if (this.mTextureCallbackFun!==null)
                  {
                           if (inp.mInfo.mType === "music")       this.mTextureCallbackFun(this.mTextureCallbackObj, i, {wave:(wa==null)?null:inp.audio.mSound.mFreqData}, false, 4, 1, inp.audio.currentTime, this.mID);
                      else if (inp.mInfo.mType === "musicstream") this.mTextureCallbackFun(this.mTextureCallbackObj, i, {wave:(wa==null)?null:inp.audio.mSound.mFreqData, info: inp.audio.soundcloudInfo}, false, 8, 1, inp.audio.currentTime, this.mID);
                  }
              }
              else if( inp.loaded===false )
              {
                  if (this.mTextureCallbackFun!==null)
                      this.mTextureCallbackFun(this.mTextureCallbackObj, i, {wave:null}, false, 4, 0, -1.0, this.mID);
              }
        }
        else if( inp.mInfo.mType==="mic" )
        {
              if( inp.loaded && inp.mForceMuted === false )
              {
                  if( wa !== null )
                  {
                      inp.mAnalyser.getByteFrequencyData(  inp.mFreqData );
                      inp.mAnalyser.getByteTimeDomainData( inp.mWaveData );
                  }
                  if( this.mTextureCallbackFun!==null )
                      this.mTextureCallbackFun( this.mTextureCallbackObj, i, {wave: ((wa==null)?null:inp.mFreqData) }, false, 5, 1, 0, this.mID );
              }
        }
        else if( inp.mInfo.mType==="buffer" )
        {
            if( inp.loaded && forceUpdate )
            {
              if( this.mTextureCallbackFun!==null )
                  this.mTextureCallbackFun( this.mTextureCallbackObj, i, {texture:inp.image, data:null}, true, 9, 1, -1.0, this.mID );
            }
        }
    }
}

EffectPass.prototype.Sampler2Renderer = function (sampler)
{
    let filter = this.mRenderer.FILTER.NONE;
    if (sampler.filter === "linear") filter = this.mRenderer.FILTER.LINEAR;
    if (sampler.filter === "mipmap") filter = this.mRenderer.FILTER.MIPMAP;
    let wrap = this.mRenderer.TEXWRP.REPEAT;
    if (sampler.wrap === "clamp") wrap = this.mRenderer.TEXWRP.CLAMP;
    let vflip = false;
    if (sampler.vflip === "true") vflip = true;

    return { mFilter: filter, mWrap: wrap, mVFlip: vflip };
}

EffectPass.prototype.GetSamplerVFlip = function (id)
{
    let inp = this.mInputs[id];
    return inp.mInfo.mSampler.vflip;
}

EffectPass.prototype.GetTranslatedShaderSource = function ()
{
    return this.mTranslatedSource;
}

EffectPass.prototype.SetSamplerVFlip = function (id, str) 
{
    var me = this;
    var renderer = this.mRenderer;
    let inp = this.mInputs[id];

    let filter = false;
    if (str === "true") filter = true;

    if (inp === null)
    {
    }
    else if (inp.mInfo.mType === "texture")
    {
        if (inp.loaded)
        {
            renderer.SetSamplerVFlip(inp.globject, filter, inp.image);
            inp.mInfo.mSampler.vflip = str;
        }
    }
    else if (inp.mInfo.mType === "volume")
    {
    }
    else if (inp.mInfo.mType === "video")
    {
        if (inp.loaded) 
        {
            renderer.SetSamplerVFlip(inp.globject, filter, inp.image);
            inp.mInfo.mSampler.vflip = str;
        }
    }
    else if (inp.mInfo.mType === "cubemap")
    {
        if (inp.loaded) 
        {
            renderer.SetSamplerVFlip(inp.globject, filter, inp.image);
            inp.mInfo.mSampler.vflip = str;
        }
    }
    else if (inp.mInfo.mType === "webcam")
    {
        if (inp.loaded) 
        {
            renderer.SetSamplerVFlip(inp.globject, filter, null);
            inp.mInfo.mSampler.vflip = str;
        }
    }
}

EffectPass.prototype.GetAcceptsVFlip = function (id)
{
    let inp = this.mInputs[id];

    if (inp === null) return false;
    if (inp.mInfo.mType === "texture") return true;
    if (inp.mInfo.mType === "volume") return false;
    if (inp.mInfo.mType === "video")  return true;
    if (inp.mInfo.mType === "cubemap") return true;
    if (inp.mInfo.mType === "webcam")  return true;
    if (inp.mInfo.mType === "music")  return false;
    if (inp.mInfo.mType === "musicstream") return false;
    if (inp.mInfo.mType === "mic")  return false;
    if (inp.mInfo.mType === "keyboard")  return false;
    if (inp.mInfo.mType === "buffer") return false;
    return true;
}

EffectPass.prototype.GetSamplerFilter = function (id)
{
    let inp = this.mInputs[id];
    if( inp===null) return;
    return inp.mInfo.mSampler.filter;
}

EffectPass.prototype.SetSamplerFilter = function (id, str, buffers, cubeBuffers) 
{
    var me = this;
    var renderer = this.mRenderer;
    let inp = this.mInputs[id];

    let filter = renderer.FILTER.NONE;
    if (str === "linear") filter = renderer.FILTER.LINEAR;
    if (str === "mipmap") filter = renderer.FILTER.MIPMAP;

    if (inp === null)
    {
    }
    else if (inp.mInfo.mType === "texture")
    {
        if (inp.loaded)
        {
            renderer.SetSamplerFilter(inp.globject, filter, true);
            inp.mInfo.mSampler.filter = str;
        }
    }
    else if (inp.mInfo.mType === "volume")
    {
        if (inp.loaded)
        {
            renderer.SetSamplerFilter(inp.globject, filter, true);
            inp.mInfo.mSampler.filter = str;
        }
    }
    else if (inp.mInfo.mType === "video")
    {
        if (inp.loaded) 
        {
            renderer.SetSamplerFilter(inp.globject, filter, true);
            inp.mInfo.mSampler.filter = str;
        }
    }
    else if (inp.mInfo.mType === "cubemap")
    {
        if (inp.loaded) 
        {
            if( assetID_to_cubemapBuferID(inp.mInfo.mID)===0)
            {
                renderer.SetSamplerFilter(cubeBuffers[0].mTexture[0], filter, true);
                renderer.SetSamplerFilter(cubeBuffers[0].mTexture[1], filter, true);
                inp.mInfo.mSampler.filter = str;
            }
            else
            {
                renderer.SetSamplerFilter(inp.globject, filter, true);
                inp.mInfo.mSampler.filter = str;
            }
        }
    }
    else if (inp.mInfo.mType === "webcam")
    {
        if (inp.loaded) 
        {
            renderer.SetSamplerFilter(inp.globject, filter, true);
            inp.mInfo.mSampler.filter = str;
        }
    }
    else if (inp.mInfo.mType === "buffer")
    {
        renderer.SetSamplerFilter(buffers[inp.id].mTexture[0], filter, true);
        renderer.SetSamplerFilter(buffers[inp.id].mTexture[1], filter, true);
        inp.mInfo.mSampler.filter = str;
    }
    else if (inp.mInfo.mType === "keyboard")
    {
        inp.mInfo.mSampler.filter = str;
    }
}

EffectPass.prototype.GetAcceptsMipmapping = function (id)
{
    let inp = this.mInputs[id];

    if (inp === null) return false;
    if (inp.mInfo.mType === "texture") return true;
    if (inp.mInfo.mType === "volume") return true;
    if (inp.mInfo.mType === "video")  return this.mIs20;
    if (inp.mInfo.mType === "cubemap") return true;
    if (inp.mInfo.mType === "webcam")  return this.mIs20;
    if (inp.mInfo.mType === "music")  return false;
    if (inp.mInfo.mType === "musicstream") return false;
    if (inp.mInfo.mType === "mic")  return false;
    if (inp.mInfo.mType === "keyboard")  return false;
    if (inp.mInfo.mType === "buffer") return this.mIs20;
    return false;
}

EffectPass.prototype.GetAcceptsLinear = function (id)
{
    let inp = this.mInputs[id];

    if (inp === null) return false;
    if (inp.mInfo.mType === "texture") return true;
    if (inp.mInfo.mType === "volume") return true;
    if (inp.mInfo.mType === "video")  return true;
    if (inp.mInfo.mType === "cubemap") return true;
    if (inp.mInfo.mType === "webcam")  return true;
    if (inp.mInfo.mType === "music")  return true;
    if (inp.mInfo.mType === "musicstream") return true;
    if (inp.mInfo.mType === "mic")  return true;
    if (inp.mInfo.mType === "keyboard")  return false;
    if (inp.mInfo.mType === "buffer") return true;
    return false;
}

EffectPass.prototype.GetAcceptsWrapRepeat = function (id)
{
    let inp = this.mInputs[id];

    if (inp === null) return false;
    if (inp.mInfo.mType === "texture") return true;
    if (inp.mInfo.mType === "volume") return true;
    if (inp.mInfo.mType === "video")  return this.mIs20;
    if (inp.mInfo.mType === "cubemap") return false;
    if (inp.mInfo.mType === "webcam")  return this.mIs20;
    if (inp.mInfo.mType === "music")  return false;
    if (inp.mInfo.mType === "musicstream") return false;
    if (inp.mInfo.mType === "mic")  return false;
    if (inp.mInfo.mType === "keyboard")  return false;
    if (inp.mInfo.mType === "buffer") return this.mIs20;
    return false;
}

EffectPass.prototype.GetSamplerWrap = function (id)
{
    return this.mInputs[id].mInfo.mSampler.wrap;
}

EffectPass.prototype.SetSamplerWrap = function (id, str, buffers)
{
    var me = this;
    var renderer = this.mRenderer;
    let inp = this.mInputs[id];

    let restr = renderer.TEXWRP.REPEAT;
    if (str === "clamp") restr = renderer.TEXWRP.CLAMP;

    if (inp === null) 
    {
    }
    else if (inp.mInfo.mType === "texture")
    {
        if (inp.loaded) 
        {
            renderer.SetSamplerWrap(inp.globject, restr);
            inp.mInfo.mSampler.wrap = str;
        }
    }
    else if (inp.mInfo.mType === "volume")
    {
        if (inp.loaded) 
        {
            renderer.SetSamplerWrap(inp.globject, restr);
            inp.mInfo.mSampler.wrap = str;
        }
    }
    else if (inp.mInfo.mType === "video") 
    {
        if (inp.loaded) 
        {
            renderer.SetSamplerWrap(inp.globject, restr);
            inp.mInfo.mSampler.wrap = str;
        }
    }
    else if (inp.mInfo.mType === "cubemap") 
    {
        if (inp.loaded)
        {
            renderer.SetSamplerWrap(inp.globject, restr);
            inp.mInfo.mSampler.wrap = str;
        }
    }
    else if (inp.mInfo.mType === "webcam") 
    {
        if (inp.loaded) 
        {
            renderer.SetSamplerWrap(inp.globject, restr);
            inp.mInfo.mSampler.wrap = str;
        }
    }
    else if (inp.mInfo.mType === "buffer")
    {
        renderer.SetSamplerWrap(buffers[inp.id].mTexture[0], restr);
        renderer.SetSamplerWrap(buffers[inp.id].mTexture[1], restr);
        inp.mInfo.mSampler.wrap = str;
    }
}


EffectPass.prototype.GetTexture = function( slot )
{
    let inp = this.mInputs[slot];
    if( inp===null ) return null;
    return inp.mInfo;
}

EffectPass.prototype.SetOutputs = function( slot, id )
{
    this.mOutputs[slot] = id;
}

EffectPass.prototype.SetOutputsByBufferID = function( slot, id )
{
    if( this.mType==="buffer" )
    {
        this.mOutputs[slot] = bufferID_to_assetID( id );

        this.mEffect.ResizeBuffer( id, this.mEffect.mXres, this.mEffect.mYres, false );
    }
    else if( this.mType==="cubemap" )
    {
        this.mOutputs[slot] = cubamepBufferID_to_assetID( id );
        this.mEffect.ResizeCubemapBuffer(id, 1024, 1024 );
    }
}

EffectPass.prototype.NewTexture = function( wa, slot, url, buffers, cubeBuffers, keyboard )
{
    var me = this;
    var renderer = this.mRenderer;

    if( renderer===null ) return;

    let texture = null;

    if( url===null || url.mType===null )
    {
        if( me.mTextureCallbackFun!==null )
            me.mTextureCallbackFun( this.mTextureCallbackObj, slot, null, true, 0, 0, -1.0, me.mID );
        me.DestroyInput( slot );
        me.mInputs[slot] = null;
        me.MakeHeader();
        return { mFailed:false, mNeedsShaderCompile:false };
    }
    else if( url.mType==="texture" )
    {
        texture = {};
        texture.mInfo = url;
        texture.globject = null;
        texture.loaded = false;
        texture.image = new Image();
        texture.image.crossOrigin = '';
        texture.image.onload = function()
        {
            let rti = me.Sampler2Renderer(url.mSampler);

            // O.M.G. FIX THIS
            let channels = renderer.TEXFMT.C4I8;
            if (url.mID === "Xdf3zn" || url.mID === "4sf3Rn" || url.mID === "4dXGzn" || url.mID === "4sf3Rr")
                channels = renderer.TEXFMT.C1I8;
            
            texture.globject = renderer.CreateTextureFromImage(renderer.TEXTYPE.T2D, texture.image, channels, rti.mFilter, rti.mWrap, rti.mVFlip);

            texture.loaded = true;
            if( me.mTextureCallbackFun!==null )
                me.mTextureCallbackFun( me.mTextureCallbackObj, slot, texture.image, true, 1, 1, -1.0, me.mID );
        }
        texture.image.src = url.mSrc;


        let returnValue = { mFailed:false, mNeedsShaderCompile: (this.mInputs[slot]===null ) || (
                                                                (this.mInputs[slot].mInfo.mType!=="texture") && 
                                                                (this.mInputs[slot].mInfo.mType!=="webcam") && 
                                                                (this.mInputs[slot].mInfo.mType!=="mic") && 
                                                                (this.mInputs[slot].mInfo.mType!=="music") && 
                                                                (this.mInputs[slot].mInfo.mType!=="musicstream") && 
                                                                (this.mInputs[slot].mInfo.mType!=="keyboard") && 
                                                                (this.mInputs[slot].mInfo.mType!=="video")) };
        this.DestroyInput( slot );
        this.mInputs[slot] = texture;
        this.MakeHeader();
        return returnValue;
    }
    else if( url.mType==="volume" )
    {
        texture = {};
        texture.mInfo = url;
        texture.globject = null;
        texture.loaded = false;
        texture.mImage = { mData:null, mXres:1, mYres:0, mZres:0 };
        texture.mPreview = new Image();
        texture.mPreview.crossOrigin = '';

	    var xmlHttp = new XMLHttpRequest();
        if( xmlHttp===null ) return { mFailed:true };

        xmlHttp.open('GET', url.mSrc, true);
        xmlHttp.responseType = "arraybuffer";
        xmlHttp.onerror = function()
        {
            console.log( "Error 1 loading Volume" );
        }
        xmlHttp.onload = function()
        {
            let data = xmlHttp.response;
            if (!data ) { console.log( "Error 2 loading Volume" ); return; }

            let file = piFile(data);

            let signature = file.ReadUInt32();
            texture.mImage.mXres = file.ReadUInt32();
            texture.mImage.mYres = file.ReadUInt32();
            texture.mImage.mZres = file.ReadUInt32();
            let binNumChannels = file.ReadUInt8();
            let binLayout = file.ReadUInt8();
            let binFormat = file.ReadUInt16();
            let format = renderer.TEXFMT.C1I8;
                 if( binNumChannels===1 && binFormat===0 )  format = renderer.TEXFMT.C1I8;
            else if( binNumChannels===2 && binFormat===0 )  format = renderer.TEXFMT.C2I8;
            else if( binNumChannels===3 && binFormat===0 )  format = renderer.TEXFMT.C3I8;
            else if( binNumChannels===4 && binFormat===0 )  format = renderer.TEXFMT.C4I8;
            else if( binNumChannels===1 && binFormat===10 ) format = renderer.TEXFMT.C1F32;
            else if( binNumChannels===2 && binFormat===10 ) format = renderer.TEXFMT.C2F32;
            else if( binNumChannels===3 && binFormat===10 ) format = renderer.TEXFMT.C3F32;
            else if( binNumChannels===4 && binFormat===10 ) format = renderer.TEXFMT.C4F32;
            else return;

            let buffer = new Uint8Array(data, 20); // skip 16 bytes (header of .bin)

            let rti = me.Sampler2Renderer(url.mSampler);

            texture.globject = renderer.CreateTexture(renderer.TEXTYPE.T3D, texture.mImage.mXres, texture.mImage.mYres, format, rti.mFilter, rti.mWrap, buffer);

            if( texture.globject===null )
            {
                console.log( "Error 4: loading Volume" ); 
                return { mFailed:true };
            }

            if (me.mTextureCallbackFun !== null)
            {
                me.mTextureCallbackFun( me.mTextureCallbackObj, slot, texture.mPreview, true, 1, 1, -1.0, me.mID );
            }

            texture.loaded = true;

            // load icon for it
            texture.mPreview.onload = function()
            {
                if( me.mTextureCallbackFun!==null )
                    me.mTextureCallbackFun( me.mTextureCallbackObj, slot, texture.mPreview, true, 1, 1, -1.0, me.mID );
            }
            texture.mPreview.src = url.mPreviewSrc;
        }
        xmlHttp.send("");


        let returnValue = { mFailed:false, mNeedsShaderCompile: (this.mInputs[slot]===null ) || (
                                                                (this.mInputs[slot].mInfo.mType!=="volume")) };
        this.DestroyInput( slot );
        this.mInputs[slot] = texture;
        this.MakeHeader();
        return returnValue;
    }
    else if( url.mType==="cubemap" )
    {
        texture = {};
        texture.mInfo = url;
        texture.globject = null;
        texture.loaded = false;

        let rti = me.Sampler2Renderer(url.mSampler);

        if( assetID_to_cubemapBuferID(url.mID)!==-1 )
        {
            texture.mImage = new Image();
            texture.mImage.onload = function()
            {
                texture.loaded = true;
                if( me.mTextureCallbackFun!==null )
                    me.mTextureCallbackFun( me.mTextureCallbackObj, slot, texture.mImage, true, 2, 1, -1.0, me.mID );
            }
            texture.mImage.src = "/media/previz/cubemap00.png";

            this.mEffect.ResizeCubemapBuffer(0, 1024, 1024 );

        }
        else
        {
            texture.image = [ new Image(), new Image(), new Image(), new Image(), new Image(), new Image() ];

            let numLoaded = 0;
            for (var i=0; i<6; i++ )
            {
                texture.image[i].mId = i;
                texture.image[i].crossOrigin = '';
                texture.image[i].onload = function()
                {
                    var id = this.mId;
                    numLoaded++;
                    if( numLoaded===6 )
                    {
                        texture.globject = renderer.CreateTextureFromImage(renderer.TEXTYPE.CUBEMAP, texture.image, renderer.TEXFMT.C4I8, rti.mFilter, rti.mWrap, rti.mVFlip);
                        texture.loaded = true;
                        if (me.mTextureCallbackFun !== null)
                            me.mTextureCallbackFun(me.mTextureCallbackObj, slot, texture.image[0], true, 2, 1, -1.0, me.mID);
                    }
                }

                if( i === 0) 
                {
                    texture.image[i].src = url.mSrc;
                } 
                else 
                {
                    let n = url.mSrc.lastIndexOf(".");
                    texture.image[i].src = url.mSrc.substring(0, n) + "_" + i + url.mSrc.substring(n, url.mSrc.length);
                }
            }
        }

        let returnValue = { mFailed:false, mNeedsShaderCompile: (this.mInputs[slot]===null ) || (
                                                                (this.mInputs[slot].mInfo.mType!=="cubemap")) };

        this.DestroyInput( slot );
        this.mInputs[slot] = texture;
        this.MakeHeader();
        return returnValue;
    }
    else if( url.mType==="webcam" )
    {
        texture = {};
        texture.mInfo = url;
        texture.globject = null;
        texture.loaded = false;

        texture.video = document.createElement('video');
    	texture.video.width = 320;
    	texture.video.height = 240;
    	texture.video.autoplay = true;
    	texture.video.loop = true;
        texture.mForceMuted = this.mForceMuted;
        texture.mImage = null;

        let rti = me.Sampler2Renderer(url.mSampler);

        var loadImageInsteadOfWebCam = function()
        {
            texture.mImage = new Image();
            texture.mImage.onload = function()
            {
                texture.loaded = true;
                texture.globject = renderer.CreateTextureFromImage(renderer.TEXTYPE.T2D, texture.mImage, renderer.TEXFMT.C4I8, rti.mFilter, rti.mWrap, rti.mVFlip);
                if( me.mTextureCallbackFun!==null )
                    me.mTextureCallbackFun( me.mTextureCallbackObj, slot, texture.mImage, true, 7, 1, -1.0, me.mID );
            }
            texture.mImage.src = "/media/previz/webcam.png";
        }
        
        loadImageInsteadOfWebCam();

        if( typeof navigator.getUserMedia !== "undefined"  && texture.mForceMuted===false )
        {
            texture.video.addEventListener("canplay", function (e)
            {
				try
				{
                    texture.mImage = null;
                    if( texture.globject != null )
                        renderer.DestroyTexture( texture.globject );
					texture.globject = renderer.CreateTextureFromImage(renderer.TEXTYPE.T2D, texture.video, renderer.TEXFMT.C4I8, rti.mFilter, rti.mWrap, rti.mVFlip);
					texture.loaded = true;
                }
                catch(e)
                {
                    loadImageInsteadOfWebCam();
	                alert( 'Your browser can not transfer webcam data to the GPU.');
                }
            } );

            navigator.mediaDevices.getUserMedia( 
                                { "video": { width: 1280, height: 720 }, "audio": false } )
                                .then( function(stream)
                                       {
                                            texture.video.srcObject = stream;
    	                               } )
                                .catch( function(error)
                                        {
                                            loadImageInsteadOfWebCam();
    		                                alert( 'Unable to capture WebCam. Please reload the page.' );
    	                                } );
        }
        let returnValue = { mFailed:false, mNeedsShaderCompile: (this.mInputs[slot]===null ) || (
                                                                (this.mInputs[slot].mInfo.mType!=="texture") && 
                                                                (this.mInputs[slot].mInfo.mType!=="webcam") && 
                                                                (this.mInputs[slot].mInfo.mType!=="mic") && 
                                                                (this.mInputs[slot].mInfo.mType!=="music") && 
                                                                (this.mInputs[slot].mInfo.mType!=="musicstream") && 
                                                                (this.mInputs[slot].mInfo.mType!=="keyboard") && 
                                                                (this.mInputs[slot].mInfo.mType!=="video")) };
        this.DestroyInput( slot );
        this.mInputs[slot] = texture;
        this.MakeHeader();
        return returnValue;
    }
    else if( url.mType==="mic" )
    {
        texture = {};
        texture.mInfo = url;
        texture.globject = null;
        texture.loaded = false;
        texture.mForceMuted = this.mForceMuted;
        texture.mAnalyser = null;
        let num = 512;
        texture.mFreqData = new Uint8Array( num );
        texture.mWaveData = new Uint8Array( num );

        if( wa === null || typeof navigator.getUserMedia === "undefined" )
        {
            if( !texture.mForceMuted ) alert( "Shadertoy: Web Audio not implement in this browser" );
            texture.mForceMuted = true; 
        }

        if( texture.mForceMuted )
        {
            texture.globject = renderer.CreateTexture(renderer.TEXTYPE.T2D, num, 2, renderer.TEXFMT.C1I8, renderer.FILTER.LINEAR, renderer.TEXWRP.CLAMP, null)
            texture.loaded = true;
        }
        else
        {
        navigator.getUserMedia( { "audio": true },
                                function(stream)
                                {
                                  texture.globject = renderer.CreateTexture(renderer.TEXTYPE.T2D, 512, 2, renderer.TEXFMT.C1I8, renderer.FILTER.LINEAR, null)
                                  texture.mic = wa.createMediaStreamSource(stream);
                                  texture.mAnalyser = wa.createAnalyser();
                                  texture.mic.connect( texture.mAnalyser );
                                  texture.loaded = true;
    	                        },
                                function(error)
                                {
    		                        alert( 'Unable open Mic. Please reload the page.' );
    	                        } );
        }
        let returnValue = { mFailed:false, mNeedsShaderCompile: (this.mInputs[slot]===null ) || (
                                                                (this.mInputs[slot].mInfo.mType!=="texture") && 
                                                                (this.mInputs[slot].mInfo.mType!=="webcam") && 
                                                                (this.mInputs[slot].mInfo.mType!=="mic") && 
                                                                (this.mInputs[slot].mInfo.mType!=="music") && 
                                                                (this.mInputs[slot].mInfo.mType!=="musicstream") && 
                                                                (this.mInputs[slot].mInfo.mType!=="keyboard") && 
                                                                (this.mInputs[slot].mInfo.mType!=="video")) };
        this.DestroyInput( slot );
        this.mInputs[slot] = texture;
        this.MakeHeader();
        return returnValue;
    }
    else if( url.mType==="video" )
    {
    	texture = {};
        texture.mInfo = url;
        texture.globject = null;
        texture.loaded = false;
        texture.video = document.createElement('video');
    	texture.video.loop = true;
        texture.video.preload = "auto";
        texture.video.mPaused = this.mForcePaused;
        texture.video.mMuted = true;//this.mForceMuted;
    	texture.video.muted  = true;//this.mForceMuted;
        if( this.mForceMuted===true )
            texture.video.volume = 0;
    	texture.video.autoplay = false;
        texture.video.hasFalled = false;
        
        let rti = me.Sampler2Renderer(url.mSampler);

        texture.video.addEventListener("canplay", function (e)
        {
            texture.video.play().then( function()
                                       {
                                           texture.video.mPaused = false;

                                           texture.globject = renderer.CreateTextureFromImage(renderer.TEXTYPE.T2D, texture.video, renderer.TEXFMT.C4I8, rti.mFilter, rti.mWrap, rti.mVFlip);
                                           texture.loaded = true;
            
                                           if( me.mTextureCallbackFun!=null )
                                               me.mTextureCallbackFun( me.mTextureCallbackObj, slot, texture.video, true, 3, 1, -1.0, me.mID );
                                        } )
                               .catch( function(error)
                                       {
                                           console.log( error );
                                       }
                                );
        } );

        texture.video.addEventListener( "error", function(e)
        {
               if( texture.video.hasFalled===true ) { alert("Error: cannot load video" ); return; }
               let str = texture.video.src;
               str = str.substr(0,str.lastIndexOf('.') ) + ".mp4";
               texture.video.src = str;
               texture.video.hasFalled = true;
        } );

        texture.video.src = url.mSrc;

        let returnValue = { mFailed:false, mNeedsShaderCompile: (this.mInputs[slot]===null ) || (
                                                                (this.mInputs[slot].mInfo.mType!=="texture") && 
                                                                (this.mInputs[slot].mInfo.mType!=="webcam") && 
                                                                (this.mInputs[slot].mInfo.mType!=="mic") && 
                                                                (this.mInputs[slot].mInfo.mType!=="music") && 
                                                                (this.mInputs[slot].mInfo.mType!=="musicstream") && 
                                                                (this.mInputs[slot].mInfo.mType!=="keyboard") && 
                                                                (this.mInputs[slot].mInfo.mType!=="video")) };
        this.DestroyInput( slot );
        this.mInputs[slot] = texture;
        this.MakeHeader();
        return returnValue;
    }
    else if( url.mType==="music" || url.mType==="musicstream" )
    {
    	texture = {};
        texture.mInfo = url;
        texture.globject = null;
        texture.loaded = false;
        texture.audio = document.createElement('audio');
    	texture.audio.loop = true;
        texture.audio.mMuted = this.mForceMuted;
        texture.audio.mForceMuted = this.mForceMuted;
        texture.audio.muted = this.mForceMuted;
        if( this.mForceMuted===true )
            texture.audio.volume = 0;
        texture.audio.autoplay = false;
        texture.audio.hasFalled = false;
        texture.audio.mPaused = false;
        texture.audio.mSound = {};

        if( this.mForceMuted===false )
        {
            if(url.mType==="musicstream" && SC === null)
            {
                alert( "Shadertoy: Soundcloud could not be reached" );
                texture.audio.mForceMuted = true;
            }
            }

        if( wa === null && this.mForceMuted===false )
        {
            alert( "Shadertoy: Web Audio not implement in this browser" );
            texture.audio.mForceMuted = true;
        }

        if( texture.audio.mForceMuted )
        {
            texture.globject = renderer.CreateTexture(renderer.TEXTYPE.T2D, 512, 2, renderer.TEXFMT.C1I8, renderer.FILTER.LINEAR, renderer.TEXWRP.CLAMP, null);
            let num = 512;
            texture.audio.mSound.mFreqData = new Uint8Array( num );
            texture.audio.mSound.mWaveData = new Uint8Array( num );
            texture.loaded = true;
        }

        texture.audio.addEventListener( "canplay", function()
        {
            if( texture===null || texture.audio===null ) return;
            if( this.mForceMuted  ) return;
            if( texture.loaded === true ) return;

            texture.globject = renderer.CreateTexture(renderer.TEXTYPE.T2D, 512, 2, renderer.TEXFMT.C1I8, renderer.FILTER.LINEAR, renderer.TEXWRP.CLAMP, null)

            texture.audio.mSound.mSource   = wa.createMediaElementSource( texture.audio );
            texture.audio.mSound.mAnalyser = wa.createAnalyser();
            texture.audio.mSound.mGain     = wa.createGain();

            texture.audio.mSound.mSource.connect(   texture.audio.mSound.mAnalyser );
            texture.audio.mSound.mAnalyser.connect( texture.audio.mSound.mGain );
            texture.audio.mSound.mGain.connect(me.mGainNode);

            texture.audio.mSound.mFreqData = new Uint8Array( texture.audio.mSound.mAnalyser.frequencyBinCount );
            texture.audio.mSound.mWaveData = new Uint8Array( texture.audio.mSound.mAnalyser.frequencyBinCount );

            if( texture.audio.mPaused )
            {
                texture.audio.pause();
            }
            else
            {
                texture.audio.play().then( function() {} ).catch( function(e){console.log("error " + e);} );
            }
            texture.loaded = true;
        } );

        texture.audio.addEventListener( "error", function(e)
        {
               if( this.mForceMuted  ) return;

               if( texture.audio.hasFalled===true ) { return; }
               let str = texture.audio.src;
               str = str.substr(0,str.lastIndexOf('.') ) + ".ogg";
               texture.audio.src = str;
               texture.audio.hasFalled = true;
        } );

        if( !texture.audio.mForceMuted )
        {
            if(url.mType==="musicstream")
            {
                SC.resolve(url.mSrc, 
                    function(song) 
                    {
                        if( song.streamable===true )
                        {
                            texture.audio.crossOrigin = 'anonymous';
                            texture.audio.src = song.stream_url;
                            texture.audio.soundcloudInfo = song;
                        }
                        else
                        {
                            alert('Shadertoy: Soundcloud 3 - This track cannot be streamed' );
                        }
                    },
                    function(error)
                    {
                        if (me.mTextureCallbackFun!==null)
                        {
                            me.mTextureCallbackFun(me.mTextureCallbackObj, slot, {wave:null}, false, 4, 0, -1.0, me.mID);
                        }
                    } );
            } 
            else
            {
                texture.audio.src = url.mSrc;
            }
        }

        if (me.mTextureCallbackFun!==null)
        {
            if (url.mType === "music")            me.mTextureCallbackFun(me.mTextureCallbackObj, slot, {wave:null}, false, 4, 0, -1.0, me.mID);
            else if (url.mType === "musicstream") me.mTextureCallbackFun(me.mTextureCallbackObj, slot, {wave:null, info: texture.audio.soundcloudInfo}, false, 8, 0, -1.0, me.mID);
        }

        let returnValue = { mFailed:false, mNeedsShaderCompile: (this.mInputs[slot]===null ) || (
                                                                (this.mInputs[slot].mInfo.mType!=="texture") && 
                                                                (this.mInputs[slot].mInfo.mType!=="webcam") && 
                                                                (this.mInputs[slot].mInfo.mType!=="mic") && 
                                                                (this.mInputs[slot].mInfo.mType!=="music") && 
                                                                (this.mInputs[slot].mInfo.mType!=="musicstream") && 
                                                                (this.mInputs[slot].mInfo.mType!=="keyboard") && 
                                                                (this.mInputs[slot].mInfo.mType!=="video")) };
        this.DestroyInput( slot );
        this.mInputs[slot] = texture;
        this.MakeHeader();
        return returnValue;
    }
    else if( url.mType==="keyboard" )
    {
    	texture = {};
        texture.mInfo = url;
        texture.globject = null;
        texture.loaded = true;

        texture.keyboard = {};

        if( me.mTextureCallbackFun!==null )
            me.mTextureCallbackFun( me.mTextureCallbackObj, slot, {mImage: keyboard.mIcon, mData: keyboard.mData}, false, 6, 1, -1.0, me.mID );

        let returnValue = { mFailed:false, mNeedsShaderCompile: (this.mInputs[slot]===null ) || (
                                                                (this.mInputs[slot].mInfo.mType!="texture") && 
                                                                (this.mInputs[slot].mInfo.mType!="webcam") && 
                                                                (this.mInputs[slot].mInfo.mType!="mic") && 
                                                                (this.mInputs[slot].mInfo.mType!="music") && 
                                                                (this.mInputs[slot].mInfo.mType!="musicstream") && 
                                                                (this.mInputs[slot].mInfo.mType!="keyboard") && 
                                                                (this.mInputs[slot].mInfo.mType!="video")) };
        this.DestroyInput( slot );
        this.mInputs[slot] = texture;
        this.MakeHeader();
        return returnValue;
    }
    else if( url.mType==="buffer" )
    {
        texture = {};
        texture.mInfo = url;

        texture.image = new Image();
        texture.image.onload = function()
        {
            if( me.mTextureCallbackFun!==null )
                me.mTextureCallbackFun( me.mTextureCallbackObj, slot, {texture: texture.image, data:null}, true, 9, 1, -1.0, me.mID );
        }
        texture.image.src = url.mSrc;
        texture.id = assetID_to_bufferID( url.mID );
        texture.loaded = true;

        let returnValue = { mFailed:false, mNeedsShaderCompile: (this.mInputs[slot]===null ) || (
                                                                (this.mInputs[slot].mInfo.mType!=="texture") && 
                                                                (this.mInputs[slot].mInfo.mType!=="webcam") && 
                                                                (this.mInputs[slot].mInfo.mType!=="mic") && 
                                                                (this.mInputs[slot].mInfo.mType!=="music") && 
                                                                (this.mInputs[slot].mInfo.mType!=="musicstream") && 
                                                                (this.mInputs[slot].mInfo.mType!=="keyboard") && 
                                                                (this.mInputs[slot].mInfo.mType!=="video")) };

        this.DestroyInput( slot );
        this.mInputs[slot] = texture;

        this.mEffect.ResizeBuffer(texture.id, this.mEffect.mXres, this.mEffect.mYres, false );

        this.SetSamplerFilter(slot, url.mSampler.filter, buffers, cubeBuffers, true);
        this.SetSamplerVFlip(slot, url.mSampler.vflip);
        this.SetSamplerWrap(slot, url.mSampler.wrap, buffers);

        this.MakeHeader();
        return returnValue;
    }
    else
    {
        alert( "input type error" );
        return { mFailed: true };
    }

    return { mFailed: true };
}

EffectPass.prototype.Paint_Image = function( vrData, wa, d, time, dtime, fps, mouseOriX, mouseOriY, mousePosX, mousePosY, xres, yres, buffers, cubeBuffers, keyboard )
{
    let times = [ 0.0, 0.0, 0.0, 0.0 ];

    let dates = [ d.getFullYear(), // the year (four digits)
                  d.getMonth(),	   // the month (from 0-11)
                  d.getDate(),     // the day of the month (from 1-31)
                  d.getHours()*60.0*60 + d.getMinutes()*60 + d.getSeconds()  + d.getMilliseconds()/1000.0 ];

    let mouse = [  mousePosX, mousePosY, mouseOriX, mouseOriY ];

    //------------------------
    
    let resos = [ 0.0,0.0,0.0, 0.0,0.0,0.0, 0.0,0.0,0.0, 0.0,0.0,0.0 ];
    let texIsLoaded = [0, 0, 0, 0 ];
    let texID = [ null, null, null, null];

    for (let i=0; i<this.mInputs.length; i++ )
    {
        let inp = this.mInputs[i];

        if( inp===null )
        {
        }
        else if( inp.mInfo.mType==="texture" )
        {
            if( inp.loaded===true  )
            {
                texID[i] = inp.globject;
                texIsLoaded[i] = 1;
                resos[3*i+0] = inp.image.width;
                resos[3*i+1] = inp.image.height;
                resos[3*i+2] = 1;
            }
        }
        else if( inp.mInfo.mType==="volume" )
        {
            if( inp.loaded===true  )
            {
                texID[i] = inp.globject;
                texIsLoaded[i] = 1;
                resos[3*i+0] = inp.mImage.mXres;
                resos[3*i+1] = inp.mImage.mYres;
                resos[3*i+2] = inp.mImage.mZres;
            }
        }
        else if( inp.mInfo.mType==="keyboard" )
        {
            texID[i] = keyboard.mTexture;
            texIsLoaded[i] = 1;
            resos[3*i+0] = 256;
            resos[3*i+1] = 3;
            resos[3*i+2] = 1;
        }
        else if( inp.mInfo.mType==="cubemap" )
        {
            if (inp.loaded === true)
            {
                let id = assetID_to_cubemapBuferID(inp.mInfo.mID);
                if( id!==-1 )
                {
                    texID[i] = cubeBuffers[id].mTexture[ cubeBuffers[id].mLastRenderDone ];
                    resos[3*i+0] = cubeBuffers[id].mResolution[0];
                    resos[3*i+1] = cubeBuffers[id].mResolution[1];
                    resos[3*i+2] = 1;
                    texIsLoaded[i] = 1;

                    // hack. in webgl2.0 we have samplers, so we don't need this crap here
                    let filter = this.mRenderer.FILTER.NONE;
                         if (inp.mInfo.mSampler.filter === "linear") filter = this.mRenderer.FILTER.LINEAR;
                    else if (inp.mInfo.mSampler.filter === "mipmap") filter = this.mRenderer.FILTER.MIPMAP;
                    this.mRenderer.SetSamplerFilter( texID[i], filter, false);
                }
                else
                {
                    texID[i] = inp.globject;
                    texIsLoaded[i] = 1;
                }
            }
        }
        else if( inp.mInfo.mType==="webcam" )
        {
            if( inp.loaded===true )
            {
                if( inp.mImage !== null )
                {
                    if( this.mTextureCallbackFun!==null )
                        this.mTextureCallbackFun( this.mTextureCallbackObj, i, inp.mImage, false, 7, 1, -1, this.mID );

                    texID[i] = inp.globject;
                    texIsLoaded[i] = 1;
                    resos[3*i+0] = inp.mImage.width;
                    resos[3*i+1] = inp.mImage.height;
                    resos[3*i+2] = 1;
                }
                else  if( inp.video.readyState === inp.video.HAVE_ENOUGH_DATA )
                {

                    if( this.mTextureCallbackFun!==null )
                        this.mTextureCallbackFun( this.mTextureCallbackObj, i, inp.video, false, 7, 1, -1, this.mID );

                    texID[i] = inp.globject;
                    this.mRenderer.UpdateTextureFromImage(inp.globject, inp.video);
                    if( inp.mInfo.mSampler.filter === "mipmap" )
                        this.mRenderer.CreateMipmaps(inp.globject);
                    resos[3*i+0] = inp.video.videoWidth;
                    resos[3*i+1] = inp.video.videoHeight;
                    resos[3*i+2] = 1;
                    texIsLoaded[i] = 1;
                }
            }
            else 
            {
                texID[i] = null;
                texIsLoaded[i] = 0;
                resos[3*i+0] = inp.video.width;
                resos[3*i+1] = inp.video.height;
                resos[3*i+2] = 1;
            }
        }
        else if( inp.mInfo.mType==="video" )
        {
            if( inp.video.mPaused === false )
            {
                if( this.mTextureCallbackFun!==null )
                    this.mTextureCallbackFun( this.mTextureCallbackObj, i, inp.video, false, 3, 1, inp.video.currentTime, this.mID );
            }

            if( inp.loaded===true )
            { 
                times[i] = inp.video.currentTime;
                texID[i] = inp.globject;
                texIsLoaded[i] = 1;

      	        if( inp.video.mPaused === false )
      	        {
      	            this.mRenderer.UpdateTextureFromImage(inp.globject, inp.video);
                    if( inp.mInfo.mSampler.filter === "mipmap" )
                        this.mRenderer.CreateMipmaps(inp.globject);
                }
                resos[3*i+0] = inp.video.videoWidth;
                resos[3*i+1] = inp.video.videoHeight;
                resos[3*i+2] = 1;
            }
        }
        else if( inp.mInfo.mType==="music" || inp.mInfo.mType==="musicstream" )
        {
            if( inp.audio.mPaused === false && inp.audio.mForceMuted === false && inp.loaded===true )
            {
                if( wa !== null )
                {
                    inp.audio.mSound.mAnalyser.getByteFrequencyData(  inp.audio.mSound.mFreqData );
                    inp.audio.mSound.mAnalyser.getByteTimeDomainData( inp.audio.mSound.mWaveData );
                }

                if( this.mTextureCallbackFun!==null )
                {
                         if( inp.mInfo.mType==="music")       this.mTextureCallbackFun(this.mTextureCallbackObj, i, (wa === null) ? null : { wave : inp.audio.mSound.mFreqData }, false, 4, 1, inp.audio.currentTime, this.mID);
                    else if( inp.mInfo.mType==="musicstream") this.mTextureCallbackFun(this.mTextureCallbackObj, i, (wa === null) ? null : { wave : inp.audio.mSound.mFreqData, info : inp.audio.soundcloudInfo}, false, 8, 1, inp.audio.currentTime, this.mID);
                }
            }

            if( inp.loaded===true )
            {
                times[i] = inp.audio.currentTime;
                texID[i] = inp.globject;
                texIsLoaded[i] = 1;

                if( inp.audio.mForceMuted === true )
                {
                    times[i] = 10.0 + time;
                    let num = inp.audio.mSound.mFreqData.length;
                    for (let j=0; j<num; j++ )
                    {
                        let x = j / num;
                        let f =  (0.75 + 0.25*Math.sin( 10.0*j + 13.0*time )) * Math.exp( -3.0*x );

                        if( j<3 )
                            f =  Math.pow( 0.50 + 0.5*Math.sin( 6.2831*time ), 4.0 ) * (1.0-j/3.0);

                        inp.audio.mSound.mFreqData[j] = Math.floor(255.0*f) | 0;
                    }

                  //let num = inp.audio.mSound.mFreqData.length;
                    for (let j=0; j<num; j++ )
                    {
                        let f = 0.5 + 0.15*Math.sin( 17.0*time + 10.0*6.2831*j/num ) * Math.sin( 23.0*time + 1.9*j/num );
                        inp.audio.mSound.mWaveData[j] = Math.floor(255.0*f) | 0;
                    }

                }

      	        if( inp.audio.mPaused === false )
                {
      	            let waveLen = Math.min(inp.audio.mSound.mWaveData.length, 512);
      	            this.mRenderer.UpdateTexture(inp.globject, 0, 0, 512, 1, inp.audio.mSound.mFreqData);
      	            this.mRenderer.UpdateTexture(inp.globject, 0, 1, 512, 1, inp.audio.mSound.mWaveData);
                }

                resos[3*i+0] = 512;
                resos[3*i+1] = 2;
                resos[3*i+2] = 1;
            }
        }
        else if( inp.mInfo.mType==="mic" )
        {
            if( inp.loaded===false || inp.mForceMuted || wa === null || inp.mAnalyser == null )
            {
                    times[i] = 10.0 + time;
                    let num = inp.mFreqData.length;
                    for( let j=0; j<num; j++ )
                    {
                        let x = j / num;
                        let f =  (0.75 + 0.25*Math.sin( 10.0*j + 13.0*time )) * Math.exp( -3.0*x );

                        if( j<3 )
                            f =  Math.pow( 0.50 + 0.5*Math.sin( 6.2831*time ), 4.0 ) * (1.0-j/3.0);

                        inp.mFreqData[j] = Math.floor(255.0*f) | 0;
                    }

                    for( let j=0; j<num; j++ )
                    {
                        let f = 0.5 + 0.15*Math.sin( 17.0*time + 10.0*6.2831*j/num ) * Math.sin( 23.0*time + 1.9*j/num );
                        inp.mWaveData[j] = Math.floor(255.0*f) | 0;
                    }
            }
            else
            {
                inp.mAnalyser.getByteFrequencyData(  inp.mFreqData );
                inp.mAnalyser.getByteTimeDomainData( inp.mWaveData );
            }

            if( this.mTextureCallbackFun!==null )
                this.mTextureCallbackFun( this.mTextureCallbackObj, i, {wave:inp.mFreqData}, false, 5, 1, -1, this.mID );

            if( inp.loaded===true )
            {
                texID[i] = inp.globject;
                texIsLoaded[i] = 1;
                let waveLen = Math.min( inp.mWaveData.length, 512 );
                this.mRenderer.UpdateTexture(inp.globject, 0, 0, 512,     1, inp.mFreqData);
                this.mRenderer.UpdateTexture(inp.globject, 0, 1, waveLen, 1, inp.mWaveData);
                resos[3*i+0] = 512;
                resos[3*i+1] = 2;
                resos[3*i+2] = 1;
            }
        }
        else if( inp.mInfo.mType==="buffer" )
        {
            let id = inp.id;
            if( inp.loaded===true  )
            {
                texID[i] = buffers[id].mTexture[ buffers[id].mLastRenderDone ];
                texIsLoaded[i] = 1;
                resos[3*i+0] = xres;
                resos[3*i+1] = yres;
                resos[3*i+2] = 1;
                // hack. in webgl2.0 we have samplers, so we don't need this crap here
                let filter = this.mRenderer.FILTER.NONE;
                     if (inp.mInfo.mSampler.filter === "linear") filter = this.mRenderer.FILTER.LINEAR;
                else if (inp.mInfo.mSampler.filter === "mipmap") filter = this.mRenderer.FILTER.MIPMAP;
                this.mRenderer.SetSamplerFilter( texID[i], filter, false);
            }

            if( this.mTextureCallbackFun!==null )
            {
                this.mTextureCallbackFun( this.mTextureCallbackObj, i, {texture:inp.image, data:buffers[id].mThumbnailBuffer}, false, 9, 1, -1, this.mID );
            }
        }
    }

    this.mRenderer.AttachTextures( 4, texID[0], texID[1], texID[2], texID[3] );

    //-----------------------------------

    let prog = this.mProgram;

    //if( vrData!=null && this.mSupportsVR ) prog = this.mProgramVR;

    this.mRenderer.AttachShader(prog);

    this.mRenderer.SetShaderConstant1F(  "iTime", time);
    this.mRenderer.SetShaderConstant3F(  "iResolution", xres, yres, 1.0);
    this.mRenderer.SetShaderConstant4FV( "iMouse", mouse);
    this.mRenderer.SetShaderConstant1FV( "iChannelTime", times );              // OBSOLETE
    this.mRenderer.SetShaderConstant4FV( "iDate", dates );
    this.mRenderer.SetShaderConstant3FV( "iChannelResolution", resos );        // OBSOLETE
    this.mRenderer.SetShaderConstant1F(  "iSampleRate", this.mSampleRate);
    this.mRenderer.SetShaderTextureUnit( "iChannel0", 0 );
    this.mRenderer.SetShaderTextureUnit( "iChannel1", 1 );
    this.mRenderer.SetShaderTextureUnit( "iChannel2", 2 );
    this.mRenderer.SetShaderTextureUnit( "iChannel3", 3 );
    this.mRenderer.SetShaderConstant1I(  "iFrame", this.mFrame );
    this.mRenderer.SetShaderConstant1F(  "iTimeDelta", dtime);
    this.mRenderer.SetShaderConstant1F("iFrameRate", fps);

    this.mRenderer.SetShaderConstant1F(  "iCh0.time", times[0] );
    this.mRenderer.SetShaderConstant1F(  "iCh1.time", times[1] );
    this.mRenderer.SetShaderConstant1F(  "iCh2.time", times[2] );
    this.mRenderer.SetShaderConstant1F(  "iCh3.time", times[3] );
    this.mRenderer.SetShaderConstant3F(  "iCh0.size", resos[0], resos[ 1], resos[ 2] );
    this.mRenderer.SetShaderConstant3F(  "iCh1.size", resos[3], resos[ 4], resos[ 5] );
    this.mRenderer.SetShaderConstant3F(  "iCh2.size", resos[6], resos[ 7], resos[ 8] );
    this.mRenderer.SetShaderConstant3F(  "iCh3.size", resos[9], resos[10], resos[11] );
    this.mRenderer.SetShaderConstant1I(  "iCh0.loaded", texIsLoaded[0] );
    this.mRenderer.SetShaderConstant1I(  "iCh1.loaded", texIsLoaded[1] );
    this.mRenderer.SetShaderConstant1I(  "iCh2.loaded", texIsLoaded[2] );
    this.mRenderer.SetShaderConstant1I(  "iCh3.loaded", texIsLoaded[3] );

    let l1 = this.mRenderer.GetAttribLocation(this.mProgram, "pos");

    if( (vrData !== null) && this.mSupportsVR )
    {
        for (let i=0; i<2; i++ )
        {
            let ei = (i===0) ? vrData.mLeftEye : vrData.mRightEye;

            let vp = [i * xres / 2, 0, xres / 2, yres];

            this.mRenderer.SetViewport(vp);

            let fov = ei.mProjection;
            let corA = [ -fov[2], -fov[1], -1.0 ];
            let corB = [  fov[3], -fov[1], -1.0 ];
            let corC = [  fov[3],  fov[0], -1.0 ];
            let corD = [ -fov[2],  fov[0], -1.0 ];
            let apex = [ 0.0, 0.0, 0.0 ];

            let ma = invertFast( ei.mCamera );
            corA = matMulpoint( ma, corA ); 
            corB = matMulpoint( ma, corB ); 
            corC = matMulpoint( ma, corC ); 
            corD = matMulpoint( ma, corD ); 
            apex = matMulpoint( ma, apex ); 

            let corners = [ corA[0], corA[1], corA[2], 
                            corB[0], corB[1], corB[2], 
                            corC[0], corC[1], corC[2], 
                            corD[0], corD[1], corD[2],
                            apex[0], apex[1], apex[2]];

            this.mRenderer.SetShaderConstant3FV("unCorners", corners);
            this.mRenderer.SetShaderConstant4FV("unViewport", vp);

            this.mRenderer.DrawUnitQuad_XY(l1);
        }
    }
    else 
    {
        this.mRenderer.SetViewport([0, 0, xres, yres]);
        this.mRenderer.DrawFullScreenTriangle_XY( l1 );
    }

    this.mRenderer.DettachTextures();
}

EffectPass.prototype.iRenderSound = function(d, callback )
{
    let dates = [ d.getFullYear(), // the year (four digits)
                  d.getMonth(),	   // the month (from 0-11)
                  d.getDate(),     // the day of the month (from 1-31)
                  d.getHours()*60.0*60 + d.getMinutes()*60 + d.getSeconds() ];

    let resos = [ 0.0,0.0,0.0, 0.0,0.0,0.0, 0.0,0.0,0.0, 0.0,0.0,0.0 ];

    this.mRenderer.SetRenderTarget(this.mRenderFBO);

    this.mRenderer.SetViewport([0, 0, this.mTextureDimensions, this.mTextureDimensions]);
    this.mRenderer.AttachShader(this.mProgram);
    this.mRenderer.SetBlend( false );

    let texID = [null, null, null, null];
    for (let i = 0; i < this.mInputs.length; i++)
    {
        let inp = this.mInputs[i];

        if( inp===null )
        {
        }
        else if( inp.mInfo.mType==="texture" )
        {
            if( inp.loaded===true  )
            {
                texID[i] = inp.globject;
                resos[3*i+0] = inp.image.width;
                resos[3*i+1] = inp.image.height;
                resos[3*i+2] = 1;
            }
        }
        else if( inp.mInfo.mType==="volume" )
        {
            if( inp.loaded===true  )
            {
                texID[i] = inp.globject;
                resos[3*i+0] = inp.mImage.mXres;
                resos[3*i+1] = inp.mImage.mYres;
                resos[3*i+2] = inp.mImage.mZres;
            }
        }
    }

    this.mRenderer.AttachTextures(4, texID[0], texID[1], texID[2], texID[3]);

    let l2 = this.mRenderer.SetShaderConstantLocation(this.mProgram, "iTimeOffset");
    let l3 = this.mRenderer.SetShaderConstantLocation(this.mProgram, "iSampleOffset");
    this.mRenderer.SetShaderConstant4FV("iDate", dates);
    this.mRenderer.SetShaderConstant3FV("iChannelResolution", resos);
    this.mRenderer.SetShaderConstant1F("iSampleRate", this.mSampleRate);
    this.mRenderer.SetShaderTextureUnit("iChannel0", 0);
    this.mRenderer.SetShaderTextureUnit("iChannel1", 1);
    this.mRenderer.SetShaderTextureUnit("iChannel2", 2);
    this.mRenderer.SetShaderTextureUnit("iChannel3", 3);

    let l1 = this.mRenderer.GetAttribLocation(this.mProgram, "pos");

    //--------------------------------
    let numSamples = this.mTmpBufferSamples;
    let numBlocks = this.mPlaySamples / numSamples;
    for (let j=0; j<numBlocks; j++ )
    {
        let off = j*numSamples;
        
        this.mRenderer.SetShaderConstant1F_Pos(l2, off / this.mSampleRate);
        this.mRenderer.SetShaderConstant1I_Pos(l3, off );
        this.mRenderer.DrawUnitQuad_XY(l1);

        this.mRenderer.GetPixelData(this.mData, 0, this.mTextureDimensions, this.mTextureDimensions);

        callback( off, this.mData, numSamples );
    }

    this.mRenderer.DetachShader();
    this.mRenderer.DettachTextures();
    this.mRenderer.SetRenderTarget(null);
}

EffectPass.prototype.Paint_Sound = function( wa, d )
{
    let bufL = this.mBuffer.getChannelData(0); // Float32Array
    let bufR = this.mBuffer.getChannelData(1); // Float32Array

    this.iRenderSound( d, function(off, data, numSamples)
                         {
                            for( let i=0; i<numSamples; i++ )
                            {
                                bufL[off+i] = -1.0 + 2.0*(data[4*i+0]+256.0*data[4*i+1])/65535.0;
                                bufR[off+i] = -1.0 + 2.0*(data[4*i+2]+256.0*data[4*i+3])/65535.0;
                            }
                         }
                     );
}

EffectPass.prototype.SetUniforms = function(vrData, wa, d, time, dtime, fps, mouseOriX, mouseOriY, mousePosX, mousePosY, xres, yres, buffers, cubeBuffers, keyboard )
{
    let times = [ 0.0, 0.0, 0.0, 0.0 ];

    let dates = [ d.getFullYear(), // the year (four digits)
                  d.getMonth(),	   // the month (from 0-11)
                  d.getDate(),     // the day of the month (from 1-31)
                  d.getHours()*60.0*60 + d.getMinutes()*60 + d.getSeconds()  + d.getMilliseconds()/1000.0 ];

    let mouse = [  mousePosX, mousePosY, mouseOriX, mouseOriY ];

    let resos = [ 0.0,0.0,0.0, 0.0,0.0,0.0, 0.0,0.0,0.0, 0.0,0.0,0.0 ];

    //------------------------
    
    let texID = [ null, null, null, null];

    for( let i=0; i<this.mInputs.length; i++ )
    {
        let inp = this.mInputs[i];

        if( inp===null )
        {
        }
        else if( inp.mInfo.mType==="texture" )
        {
            if( inp.loaded===true  )
            {
                texID[i] = inp.globject;
                resos[3*i+0] = inp.image.width;
                resos[3*i+1] = inp.image.height;
                resos[3*i+2] = 1;
            }
        }
        else if( inp.mInfo.mType==="volume" )
        {
            if( inp.loaded===true  )
            {
                texID[i] = inp.globject;
                resos[3*i+0] = inp.mImage.mXres;
                resos[3*i+1] = inp.mImage.mYres;
                resos[3*i+2] = inp.mImage.mZres;
            }
        }
        else if( inp.mInfo.mType==="keyboard" )
        {
            texID[i] = keyboard.mTexture;
        }
        else if( inp.mInfo.mType=="cubemap" )
        {
            if (inp.loaded === true)
            {
                let id = assetID_to_cubemapBuferID(inp.mInfo.mID);
                if( id!==-1 )
                {
                    texID[i] = cubeBuffers[id].mTexture[ cubeBuffers[id].mLastRenderDone ];
                    resos[3*i+0] = cubeBuffers[id].mResolution[0];
                    resos[3*i+1] = cubeBuffers[id].mResolution[1];
                    resos[3*i+2] = 1;
    
                    // hack. in webgl2.0 we have samplers, so we don't need this crap here
                    let filter = this.mRenderer.FILTER.NONE;
                         if (inp.mInfo.mSampler.filter === "linear") filter = this.mRenderer.FILTER.LINEAR;
                    else if (inp.mInfo.mSampler.filter === "mipmap") filter = this.mRenderer.FILTER.MIPMAP;
                    this.mRenderer.SetSamplerFilter( texID[i], filter, false);
                }
                else
                {
                    texID[i] = inp.globject;
                }
            }

        }
        else if( inp.mInfo.mType==="webcam" )
        {
            if( inp.loaded===true )
            {
                if( inp.mImage !== null )
                {
                    texID[i] = inp.globject;
                    resos[3*i+0] = inp.mImage.width;
                    resos[3*i+1] = inp.mImage.height;
                    resos[3*i+2] = 1;
                }
                else  if( inp.video.readyState === inp.video.HAVE_ENOUGH_DATA )
                {
                    texID[i] = inp.globject;
                    resos[3*i+0] = inp.video.videoWidth;
                    resos[3*i+1] = inp.video.videoHeight;
                    resos[3*i+2] = 1;
                }
            }
            else 
            {
                texID[i] = null;
                resos[3*i+0] = inp.video.width;
                resos[3*i+1] = inp.video.height;
                resos[3*i+2] = 1;
            }
        }
        else if( inp.mInfo.mType==="video" )
        {
           if( inp.loaded===true )
           { 
                times[i] = inp.video.currentTime;
                texID[i] = inp.globject;
                resos[3*i+0] = inp.video.videoWidth;
                resos[3*i+1] = inp.video.videoHeight;
                resos[3*i+2] = 1;
            }
        }
        else if( inp.mInfo.mType==="music" || inp.mInfo.mType==="musicstream" )
        {
            if( inp.loaded===true )
            {
                times[i] = inp.audio.currentTime;
                texID[i] = inp.globject;

                if( inp.audio.mForceMuted === true )
                {
                    times[i] = 10.0 + time;
                }

                resos[3*i+0] = 512;
                resos[3*i+1] = 2;
                resos[3*i+2] = 1;
            }
        }
        else if( inp.mInfo.mType==="mic" )
        {
            if( inp.loaded===false || inp.mForceMuted || wa === null || inp.mAnalyser == null )
            {
                times[i] = 10.0 + time;
            }

            if( inp.loaded===true )
            {
                texID[i] = inp.globject;
                resos[3*i+0] = 512;
                resos[3*i+1] = 2;
                resos[3*i+2] = 1;
            }
        }
        else if( inp.mInfo.mType==="buffer" )
        {
            if( inp.loaded===true  )
            {
                texID[i] = buffers[inp.id].mTexture[ buffers[inp.id].mLastRenderDone ];
                resos[3*i+0] = buffers[inp.id].mResolution[0];
                resos[3*i+1] = buffers[inp.id].mResolution[1];
                resos[3*i+2] = 1;
            }
        }
    }

    this.mRenderer.AttachTextures( 4, texID[0], texID[1], texID[2], texID[3] );

    //-----------------------------------

    this.mRenderer.AttachShader(this.mProgram);

    this.mRenderer.SetShaderConstant1F(  "iTime", time);
    this.mRenderer.SetShaderConstant3F(  "iResolution", xres, yres, 1.0);
    this.mRenderer.SetShaderConstant4FV( "iMouse", mouse);
    this.mRenderer.SetShaderConstant1FV( "iChannelTime", times );              // OBSOLETE
    this.mRenderer.SetShaderConstant4FV( "iDate", dates );
    this.mRenderer.SetShaderConstant3FV( "iChannelResolution", resos );        // OBSOLETE
    this.mRenderer.SetShaderConstant1F(  "iSampleRate", this.mSampleRate);
    this.mRenderer.SetShaderTextureUnit( "iChannel0", 0 );
    this.mRenderer.SetShaderTextureUnit( "iChannel1", 1 );
    this.mRenderer.SetShaderTextureUnit( "iChannel2", 2 );
    this.mRenderer.SetShaderTextureUnit( "iChannel3", 3 );
    this.mRenderer.SetShaderConstant1I(  "iFrame", this.mFrame );
    this.mRenderer.SetShaderConstant1F(  "iTimeDelta", dtime);
    this.mRenderer.SetShaderConstant1F(  "iFrameRate", fps );

    this.mRenderer.SetShaderConstant1F(  "iChannel[0].time",       times[0] );
    this.mRenderer.SetShaderConstant1F(  "iChannel[1].time",       times[1] );
    this.mRenderer.SetShaderConstant1F(  "iChannel[2].time",       times[2] );
    this.mRenderer.SetShaderConstant1F(  "iChannel[3].time",       times[3] );
    this.mRenderer.SetShaderConstant3F(  "iChannel[0].resolution", resos[0], resos[ 1], resos[ 2] );
    this.mRenderer.SetShaderConstant3F(  "iChannel[1].resolution", resos[3], resos[ 4], resos[ 5] );
    this.mRenderer.SetShaderConstant3F(  "iChannel[2].resolution", resos[6], resos[ 7], resos[ 8] );
    this.mRenderer.SetShaderConstant3F(  "iChannel[3].resolution", resos[9], resos[10], resos[11] );
}

EffectPass.prototype.ProcessInputs = function(vrData, wa, d, time, dtime, fps, mouseOriX, mouseOriY, mousePosX, mousePosY, xres, yres, buffers, cubeBuffers, keyboard )
{
    for (let i=0; i<this.mInputs.length; i++ )
    {
        let inp = this.mInputs[i];

        if( inp===null )
        {
        }
        else if( inp.mInfo.mType==="texture" )
        {
        }
        else if( inp.mInfo.mType==="volume" )
        {
        }
        else if( inp.mInfo.mType==="keyboard" )
        {
        }
        else if( inp.mInfo.mType==="cubemap" )
        {
        }
        else if( inp.mInfo.mType==="webcam" )
        {
            if( inp.loaded===true )
            {
                if( inp.mImage !== null )
                {
                    if( this.mTextureCallbackFun!==null )
                        this.mTextureCallbackFun( this.mTextureCallbackObj, i, inp.mImage, false, 7, 1, -1, this.mID );
                }
                else if( inp.video.readyState === inp.video.HAVE_ENOUGH_DATA )
                {
                    if( this.mTextureCallbackFun!==null )
                        this.mTextureCallbackFun( this.mTextureCallbackObj, i, inp.video, false, 7, 1, -1, this.mID );

                    this.mRenderer.UpdateTextureFromImage(inp.globject, inp.video);
                    if( inp.mInfo.mSampler.filter === "mipmap" )
                        this.mRenderer.CreateMipmaps(inp.globject);
                }
            }
        }
        else if( inp.mInfo.mType==="video" )
        {
            if( inp.video.mPaused === false )
            {
                if( this.mTextureCallbackFun!==null )
                    this.mTextureCallbackFun( this.mTextureCallbackObj, i, inp.video, false, 3, 1, inp.video.currentTime, this.mID );
            }

            if( inp.loaded===true )
            { 
      	        if( inp.video.mPaused === false )
      	        {
      	            this.mRenderer.UpdateTextureFromImage(inp.globject, inp.video);
                    if( inp.mInfo.mSampler.filter === "mipmap" )
                        this.mRenderer.CreateMipmaps(inp.globject);
                }
            }
        }
        else if( inp.mInfo.mType==="music" || inp.mInfo.mType==="musicstream" )
        {
            if( inp.audio.mPaused === false && inp.audio.mForceMuted === false && inp.loaded===true )
            {
                if( wa !== null )
                {
                    inp.audio.mSound.mAnalyser.getByteFrequencyData(  inp.audio.mSound.mFreqData );
                    inp.audio.mSound.mAnalyser.getByteTimeDomainData( inp.audio.mSound.mWaveData );
                }

                if( this.mTextureCallbackFun!==null )
                {
                         if( inp.mInfo.mType==="music")       this.mTextureCallbackFun(this.mTextureCallbackObj, i, (wa == null) ? null : { wave : inp.audio.mSound.mFreqData }, false, 4, 1, inp.audio.currentTime, this.mID);
                    else if( inp.mInfo.mType==="musicstream") this.mTextureCallbackFun(this.mTextureCallbackObj, i, (wa == null) ? null : { wave : inp.audio.mSound.mFreqData, info : inp.audio.soundcloudInfo}, false, 8, 1, inp.audio.currentTime, this.mID);
                }
            }

            if( inp.loaded===true )
            {
                if( inp.audio.mForceMuted === true )
                {
                    let num = inp.audio.mSound.mFreqData.length;
                    for (let j=0; j<num; j++ )
                    {
                        let x = j / num;
                        let f =  (0.75 + 0.25*Math.sin( 10.0*j + 13.0*time )) * Math.exp( -3.0*x );

                        if( j<3 )
                            f =  Math.pow( 0.50 + 0.5*Math.sin( 6.2831*time ), 4.0 ) * (1.0-j/3.0);

                        inp.audio.mSound.mFreqData[j] = Math.floor(255.0*f) | 0;
                    }

                  //let num = inp.audio.mSound.mFreqData.length;
                    for (let j=0; j<num; j++ )
                    {
                        let f = 0.5 + 0.15*Math.sin( 17.0*time + 10.0*6.2831*j/num ) * Math.sin( 23.0*time + 1.9*j/num );
                        inp.audio.mSound.mWaveData[j] = Math.floor(255.0*f) | 0;
                    }

                }

      	        if( inp.audio.mPaused === false )
                {
      	            let waveLen = Math.min(inp.audio.mSound.mWaveData.length, 512);
      	            this.mRenderer.UpdateTexture(inp.globject, 0, 0, 512, 1, inp.audio.mSound.mFreqData);
      	            this.mRenderer.UpdateTexture(inp.globject, 0, 1, 512, 1, inp.audio.mSound.mWaveData);
                }
            }
        }
        else if( inp.mInfo.mType==="mic" )
        {
            if( inp.loaded===false || inp.mForceMuted || wa === null || inp.mAnalyser == null )
            {
                    let num = inp.mFreqData.length;
                    for( let j=0; j<num; j++ )
                    {
                        let x = j / num;
                        let f =  (0.75 + 0.25*Math.sin( 10.0*j + 13.0*time )) * Math.exp( -3.0*x );

                        if( j<3 )
                            f =  Math.pow( 0.50 + 0.5*Math.sin( 6.2831*time ), 4.0 ) * (1.0-j/3.0);

                        inp.mFreqData[j] = Math.floor(255.0*f) | 0;
                    }

                    for( let j=0; j<num; j++ )
                    {
                        let f = 0.5 + 0.15*Math.sin( 17.0*time + 10.0*6.2831*j/num ) * Math.sin( 23.0*time + 1.9*j/num );
                        inp.mWaveData[j] = Math.floor(255.0*f) | 0;
                    }
            }
            else
            {
                inp.mAnalyser.getByteFrequencyData(  inp.mFreqData );
                inp.mAnalyser.getByteTimeDomainData( inp.mWaveData );
            }

            if( this.mTextureCallbackFun!==null )
                this.mTextureCallbackFun( this.mTextureCallbackObj, i, {wave:inp.mFreqData}, false, 5, 1, -1, this.mID );

            if( inp.loaded===true )
            {
                let waveLen = Math.min( inp.mWaveData.length, 512 );
                this.mRenderer.UpdateTexture(inp.globject, 0, 0, 512,     1, inp.mFreqData);
                this.mRenderer.UpdateTexture(inp.globject, 0, 1, waveLen, 1, inp.mWaveData);
            }
        }
        else if( inp.mInfo.mType==="buffer" )
        {
            if( inp.loaded===true  )
            {
                let id = inp.id;
                let texID = buffers[id].mTexture[ buffers[id].mLastRenderDone ];

                // hack. in webgl2.0 we have samplers, so we don't need this crap here
                let filter = this.mRenderer.FILTER.NONE;
                     if (inp.mInfo.mSampler.filter === "linear") filter = this.mRenderer.FILTER.LINEAR;
                else if (inp.mInfo.mSampler.filter === "mipmap") filter = this.mRenderer.FILTER.MIPMAP;
                this.mRenderer.SetSamplerFilter( texID, filter, false);
            }

            if( this.mTextureCallbackFun!==null )
            {
				let id = inp.id;
                this.mTextureCallbackFun( this.mTextureCallbackObj, i, {texture:inp.image, data:buffers[id].mThumbnailBuffer}, false, 9, 1, -1, this.mID );
            }
        }
    }
}

EffectPass.prototype.Paint_Cubemap = function( vrData, wa, d, time, dtime, fps, mouseOriX, mouseOriY, mousePosX, mousePosY, xres, yres, buffers, cubeBuffers, keyboard, face )
{
    this.ProcessInputs(vrData, wa, d, time, dtime, fps, mouseOriX, mouseOriY, mousePosX, mousePosY, xres, yres, buffers, cubeBuffers, keyboard, face );
    this.SetUniforms(vrData, wa, d, time, dtime, fps, mouseOriX, mouseOriY, mousePosX, mousePosY, xres, yres, buffers, cubeBuffers, keyboard );

    let l1 = this.mRenderer.GetAttribLocation(this.mProgram, "pos");

    let vp = [0, 0, xres, yres];

    this.mRenderer.SetViewport(vp);

    let corA = [-1.0, -1.0, -1.0];
    let corB = [ 1.0, -1.0, -1.0];
    let corC = [ 1.0,  1.0, -1.0];
    let corD = [-1.0,  1.0, -1.0];
    let apex = [ 0.0,  0.0,  0.0];

         if( face===0 ) { corA=[ 1.0,  1.0,  1.0]; corB=[ 1.0,  1.0, -1.0]; corC=[ 1.0, -1.0, -1.0]; corD=[ 1.0, -1.0,  1.0]; }
    else if( face===1 ) { corA=[-1.0,  1.0, -1.0]; corB=[-1.0,  1.0,  1.0]; corC=[-1.0, -1.0,  1.0]; corD=[-1.0, -1.0, -1.0]; }
    else if( face===2 ) { corA=[-1.0,  1.0, -1.0]; corB=[ 1.0,  1.0, -1.0]; corC=[ 1.0,  1.0,  1.0]; corD=[-1.0,  1.0,  1.0]; }
    else if( face===3 ) { corA=[-1.0, -1.0,  1.0]; corB=[ 1.0, -1.0,  1.0]; corC=[ 1.0, -1.0, -1.0]; corD=[-1.0, -1.0, -1.0]; }
    else if( face===4 ) { corA=[-1.0,  1.0,  1.0]; corB=[ 1.0,  1.0,  1.0]; corC=[ 1.0, -1.0,  1.0]; corD=[-1.0, -1.0,  1.0]; }
    else if( face===5 ) { corA=[ 1.0,  1.0, -1.0]; corB=[-1.0,  1.0, -1.0]; corC=[-1.0, -1.0, -1.0]; corD=[ 1.0, -1.0, -1.0]; }

    let corners = [ corA[0], corA[1], corA[2], 
                    corB[0], corB[1], corB[2], 
                    corC[0], corC[1], corC[2], 
                    corD[0], corD[1], corD[2],
                    apex[0], apex[1], apex[2]];

    this.mRenderer.SetShaderConstant3FV("unCorners", corners);
    this.mRenderer.SetShaderConstant4FV("unViewport", vp);

    this.mRenderer.DrawUnitQuad_XY(l1);

    this.mRenderer.DettachTextures();
}

EffectPass.prototype.Paint = function( vrData, wa, da, time, dtime, fps, mouseOriX, mouseOriY, mousePosX, mousePosY, xres, yres, isPaused, bufferID, bufferNeedsMimaps, buffers, cubeBuffers, keyboard, effect )
{
    if( this.mType==="sound" )
    {
        if (this.mSoundShaderCompiled === true)
        {
            // make sure all textures are loaded
            for (let i=0; i<this.mInputs.length; i++ )
            {
                let inp = this.mInputs[i];
                if (inp === null) continue;

                if (inp.mInfo.mType === "texture" && !inp.loaded) return;
                if (inp.mInfo.mType === "cubemap" && !inp.loaded) return;
            }

            this.Paint_Sound(wa, da);
            this.mSoundShaderCompiled = false;
        }
        if (this.mFrame === 0)
        {
            if (this.mPlaying===true)
            {
                this.mPlayNode.disconnect();
                this.mPlayNode.stop();
                this.mPlayNode = null;
            }
            this.mPlaying = true;

            this.mPlayNode = wa.createBufferSource();
            this.mPlayNode.buffer = this.mBuffer;
            this.mPlayNode.connect(this.mGainNode);
            this.mPlayNode.start(0);
        }
        this.mFrame++;
    }
    else if( this.mType==="image" )
    {
        this.mRenderer.SetRenderTarget( null );
        this.Paint_Image( vrData, wa, da, time, dtime, fps, mouseOriX, mouseOriY, mousePosX, mousePosY, xres, yres, buffers, cubeBuffers, keyboard );
        this.mFrame++;
    }
    else if( this.mType==="common" )
    {
    }
    else if( this.mType==="buffer" )
    {
        this.mEffect.ResizeBuffer(bufferID, this.mEffect.mXres, this.mEffect.mYres, false );

        let buffer = buffers[bufferID];

        let dstID = 1 - buffer.mLastRenderDone;

        this.mRenderer.SetRenderTarget( buffer.mTarget[dstID] );
        this.Paint_Image( vrData, wa, da, time, dtime, fps, mouseOriX, mouseOriY, mousePosX, mousePosY, xres, yres, buffers, cubeBuffers, keyboard );

        // compute mipmaps if needd
        if( bufferNeedsMimaps )
        {
            this.mRenderer.CreateMipmaps( buffer.mTexture[dstID]);
        }

        // make thumbnail
        //if( this.mTextureCallbackFun != null )
        /*
        {
            this.mRenderer.SetRenderTarget( buffer.mThumbnailRenderTarget );
            let v = [0, 0, buffer.mThumbnailRes[0], buffer.mThumbnailRes[1]];
            this.mRenderer.SetBlend(false);
            this.mRenderer.SetViewport(v);
            this.mRenderer.AttachShader(this.mProgramCopy);
            let l1 = this.mRenderer.GetAttribLocation(this.mProgramCopy, "pos");
            this.mRenderer.SetShaderConstant4FV("v", v);
            this.mRenderer.AttachTextures(1, buffer.mTexture[dstID], null, null, null);
            this.mRenderer.DrawUnitQuad_XY(l1);
            this.mRenderer.DettachTextures();
            this.mRenderer.DetachShader();
            this.mRenderer.GetPixelData( new Uint8Array(buffer.mThumbnailBuffer.data.buffer), buffer.mThumbnailRes[0], buffer.mThumbnailRes[1] );
            this.mRenderer.SetRenderTarget(null);
        }
        */
        buffers[bufferID].mLastRenderDone = 1 - buffers[bufferID].mLastRenderDone;
        this.mFrame++;
    }
    else if( this.mType==="cubemap" )
    {
        this.mEffect.ResizeCubemapBuffer(bufferID, 1024, 1024, false );

        let buffer = cubeBuffers[bufferID];

        xres = buffer.mResolution[0];
        yres = buffer.mResolution[1];
        let dstID = 1 - buffer.mLastRenderDone;
        for( let face=0; face<6; face++ )
        {
            this.mRenderer.SetRenderTargetCubeMap( buffer.mTarget[dstID], face );
            this.Paint_Cubemap( vrData, wa, da, time, dtime, fps, mouseOriX, mouseOriY, mousePosX, mousePosY, xres, yres, buffers, cubeBuffers, keyboard, face );
        }
        this.mRenderer.SetRenderTargetCubeMap( null, 0 );

        // compute mipmaps if needd
        if( bufferNeedsMimaps )
        {
            this.mRenderer.CreateMipmaps( buffer.mTexture[dstID]);
        }
        cubeBuffers[bufferID].mLastRenderDone = 1 - cubeBuffers[bufferID].mLastRenderDone;

        this.mFrame++;
    }
}

EffectPass.prototype.StopOutput_Sound = function( wa )
{
    if( this.mPlayNode===null ) return;
    this.mPlayNode.disconnect();
}

EffectPass.prototype.ResumeOutput_Sound = function( wa )
{
    if( this.mPlayNode===null ) return;

    wa.resume()
    this.mPlayNode.connect( this.mGainNode );
}

EffectPass.prototype.StopOutput_Image = function( wa )
{
}

EffectPass.prototype.ResumeOutput_Image = function( wa )
{
}

EffectPass.prototype.StopOutput = function( wa )
{
    for (let j=0; j<this.mInputs.length; j++ )
        this.StopInput(j);

    if( this.mType==="sound" )
         this.StopOutput_Sound( wa );
    else
         this.StopOutput_Image( wa );
}

EffectPass.prototype.ResumeOutput = function( wa )
{
    for (let j=0; j<this.mInputs.length; j++ )
        this.ResumeInput(j);

    if( this.mType==="sound" )
         this.ResumeOutput_Sound( wa );
    else
         this.ResumeOutput_Image( wa );
}

EffectPass.prototype.GetCompilationTime = function()
{
    return this.mCompilationTime;
}

//============================================================================================================
function Screenshots()
{
    // private
    let mTexture = null;
    let mTarget = null;
    let mXres = 0;
    let mYres = 0;
    let mCubemapToEquirectProgram;
    let mRenderer = null;

    // public
    var me = {};

    me.Initialize = function(renderer)
    {
        mRenderer = renderer;
        let caps = mRenderer.GetCaps();
        let is20 = caps.mIsGL20;

        let vsSourceC, fsSourceC;
        if( is20 )
        {
            vsSourceC = "layout(location = 0) in vec2 pos; void main() { gl_Position = vec4(pos.xy,0.0,1.0); }";
            fsSourceC = "uniform samplerCube t; out vec4 outColor; void main() { vec2 px = gl_FragCoord.xy/vec2(4096.0,2048.0); vec2 an = 3.1415926535898 * (px*vec2(2.0, 1.0) - vec2(0.0,0.5)); vec3 rd = vec3(-cos(an.y) * sin(an.x), sin(an.y), cos(an.y) * cos(an.x)); outColor = texture(t, rd); }";
        }
        else
        {
            vsSourceC = "attribute vec2 pos; void main() { gl_Position = vec4(pos.xy,0.0,1.0); }";
            fsSourceC = "uniform samplerCube t; void main() { vec2 px = gl_FragCoord.xy/vec2(4096.0,2048.0); vec2 an = 3.1415926535898 * (px*vec2(2.0, 1.0) - vec2(0.0,0.5)); vec3 rd = vec3(-cos(an.y) * sin(an.x), sin(an.y), cos(an.y) * cos(an.x)); gl_FragColor = texture(t, rd); }";
        }

        let compileShader = function (worked, info)
        {
            if (worked === false)
            {
                console.log("Failed to compile cubemap resample shader (" + errorType + "): " + log);
            }
            else
            {
                mCubemapToEquirectProgram = info;
            }
        }
        mRenderer.CreateShader(vsSourceC, fsSourceC, false, true, compileShader);

        return true;
    };

    me.Allocate = function( xres, yres )
    {
        if( xres>mXres || yres>mYres )
        {
            let texture = mRenderer.CreateTexture(mRenderer.TEXTYPE.T2D, xres, yres, mRenderer.TEXFMT.C4F32, mRenderer.FILTER.NONE, mRenderer.TEXWRP.CLAMP, null);
            let target = mRenderer.CreateRenderTarget( texture, null, null, null, null, false);

            if( mXres!==0 )
            {
                mRenderer.DestroyTexture(mTexture);
                mRenderer.DestroyRenderTarget(mTarget);
            }

            mTexture = texture;
            mTarget = target;
            mXres = xres;
            mYres = yres;
        }
    };

    me.GetProgram = function()
    {
        return mCubemapToEquirectProgram;
    };
    me.GetTarget = function()
    {
        return mTarget;
    };

    return me;
};

//============================================================================================================

function Effect(vr, ac, canvas, callback, obj, forceMuted, forcePaused, resizeCallback, crashCallback )
{
    let xres = canvas.width;
    let yres = canvas.height;

    let me = this;
    this.mCanvas = canvas;
    this.mCreated = false;
    this.mRenderer = null;
    this.mAudioContext = ac;
    this.mGLContext = null;
    this.mWebVR = vr;
    this.mRenderingStereo = false;
    this.mXres = xres;
    this.mYres = yres;
    this.mForceMuted = forceMuted;
    if( ac===null ) this.mForceMuted = true;
    this.mForcePaused = forcePaused;
    this.mGainNode = null;
    this.mPasses = [];
    this.mFrame = 0;
    this.mTextureCallbackFun = callback;
    this.mTextureCallbackObj = obj;
    this.mMaxBuffers = 4;
    this.mMaxCubeBuffers = 1;
    this.mMaxPasses = this.mMaxBuffers + 1 + 1 + 1 + 1; // some day decouple passes from buffers (4 buffers + common + Imagen + sound + cubemap)
    this.mBuffers = [];
    this.mCubeBuffers = [];
    this.mScreenshotSytem = null;
    this.mCompilationTime = 0;
    this.mIsLowEnd = piIsMobile();

    this.mGLContext = piCreateGlContext(canvas, false, false, true, false); // need preserve-buffe to true in order to capture screenshots
    if (this.mGLContext === null)
    {
        return;
    }

    canvas.addEventListener("webglcontextlost", function (event)
        {
            event.preventDefault();
            crashCallback();
        }, false);

    this.mRenderer = piRenderer();
    if (!this.mRenderer.Initialize(this.mGLContext))
        return;

    this.mScreenshotSytem = Screenshots();
    if (!this.mScreenshotSytem.Initialize(this.mRenderer))
        return;

    var caps = this.mRenderer.GetCaps();
    this.mIs20 = caps.mIsGL20;
    this.mShaderTextureLOD = caps.mShaderTextureLOD;
    //-------------
    if( ac!==null )
    {   
        this.mGainNode = ac.createGain();
        if( !forceMuted )
        {
            this.mGainNode.connect( ac.destination);
        }
        if (this.mForceMuted )
            this.mGainNode.gain.value = 0.0;
        else
            this.mGainNode.gain.value = 1.0;
    }

    //-------------
    let vsSourceC, fsSourceC;
    if( this.mIs20 )
    {
        vsSourceC = "layout(location = 0) in vec2 pos; void main() { gl_Position = vec4(pos.xy,0.0,1.0); }";
        fsSourceC = "uniform vec4 v; uniform sampler2D t; out vec4 outColor; void main() { outColor = textureLod(t, gl_FragCoord.xy / v.zw, 0.0); }";
    }
    else
    {
        vsSourceC = "attribute vec2 pos; void main() { gl_Position = vec4(pos.xy,0.0,1.0); }";
        fsSourceC = "uniform vec4 v; uniform sampler2D t; void main() { gl_FragColor = texture2D(t, gl_FragCoord.xy / v.zw, -100.0); }";
    }

    this.mRenderer.CreateShader(vsSourceC, fsSourceC, false, true, function(worked, info)
        {
            if (worked === false) console.log("Failed to compile shader to copy buffers : " + info.mErrorStr);
            else me.mProgramCopy = info;
        });

    let vsSourceD, fsSourceD;
    if( this.mIs20 )
    {
        vsSourceD = "layout(location = 0) in vec2 pos; void main() { gl_Position = vec4(pos.xy,0.0,1.0); }";
        fsSourceD = "uniform vec4 v; uniform sampler2D t; out vec4 outColor; void main() { vec2 uv = gl_FragCoord.xy / v.zw; outColor = texture(t, vec2(uv.x,1.0-uv.y)); }";
    }
    else
    {
        vsSourceD = "attribute vec2 pos; void main() { gl_Position = vec4(pos.xy,0.0,1.0); }";
        fsSourceD = "uniform vec4 v; uniform sampler2D t; void main() { vec2 uv = gl_FragCoord.xy / v.zw; gl_FragColor = texture2D(t, vec2(uv.x,1.0-uv.y)); }";
    }

    this.mRenderer.CreateShader(vsSourceD, fsSourceD, false, true, function (worked, info)
        {
            if (worked === false) console.log("Failed to compile shader to downscale buffers : " + info.mErrorStr);
            else me.mProgramDownscale = info;
        });


    // set all buffers and cubemaps to null
    for( let i=0; i<this.mMaxBuffers; i++ )
    {
        this.mBuffers[i] = { mTexture: [null, null], 
                             mTarget:  [null, null], 
                             mResolution: [0, 0],
                             mLastRenderDone: 0,
                             mThumbnailRenderTarget: null,
                             mThumbnailTexture: null,
                             mThumbnailBuffer:  null,
                             mThumbnailRes: [0, 0] };
    }

    for( let i=0; i<this.mMaxCubeBuffers; i++ )
    {
        this.mCubeBuffers[i] = { mTexture: [null, null], 
                                mTarget:  [null, null], 
                                mResolution: [0, 0],
                                mLastRenderDone: 0,
                                mThumbnailRenderTarget: null,
                                mThumbnailTexture: null,
                                mThumbnailBuffer:  null,
                                mThumbnailRes: [0, 0] };
    }

    //-------

    let keyboardData = new Uint8Array( 256*3 );
    for (let j=0; j<(256*3); j++ ) { keyboardData[j] = 0; }
    let kayboardTexture = this.mRenderer.CreateTexture( this.mRenderer.TEXTYPE.T2D, 256, 3, this.mRenderer.TEXFMT.C1I8, this.mRenderer.FILTER.NONE, this.mRenderer.TEXWRP.CLAMP, null);
    let keyboardImage = new Image();
    if( callback!==null )
        keyboardImage.src = "/img/keyboard.png"; // don't load PNG if no UI 
    this.mKeyboard = { mData: keyboardData, mTexture: kayboardTexture, mIcon: keyboardImage };

    let iResize = function( xres, yres )
    {
        me.mCanvas.width = xres;
        me.mCanvas.height = yres;
        me.mXres = xres;
        me.mYres = yres;
        me.ResizeBuffers(xres, yres);
        resizeCallback(xres, yres);
    };

    let bestAttemptFallback = function()
    {
        let devicePixelRatio = window.devicePixelRatio || 1;
        let xres = Math.round(me.mCanvas.offsetWidth  * devicePixelRatio) | 0;
        let yres = Math.round(me.mCanvas.offsetHeight * devicePixelRatio) | 0;
        iResize(xres, yres);
    };

    if(!window.ResizeObserver)
    {
        console.log("WARNING: This browser doesn't support ResizeObserver.");
        bestAttemptFallback();
        window.addEventListener("resize", bestAttemptFallback);
    }
    else
    {
        this.mRO = new ResizeObserver( function(entries, observer)
        {
            var entry = entries[0];
            if (!entry['devicePixelContentBoxSize'])
            {
                observer.unobserve(me.mCanvas);
                console.log("WARNING: This browser doesn't support ResizeObserver + device-pixel-content-box (2)");
                bestAttemptFallback();
                window.addEventListener("resize", bestAttemptFallback);
            }
            else
            {
                let box = entry.devicePixelContentBoxSize[0];
                let xres = box.inlineSize;
                let yres = box.blockSize;
                iResize(xres, yres);
            }
        });
        try
        {
            this.mRO.observe(this.mCanvas, { box: ["device-pixel-content-box"] });
            //this.mRO.observe(this.mCanvas);
        }
        catch (e)
        {
            console.log("WARNING: This browser doesn't support ResizeObserver + device-pixel-content-box (1)");
            bestAttemptFallback();
            window.addEventListener("resize", bestAttemptFallback);
        }
    }

    this.mCreated = true;
}

Effect.prototype.ResizeCubemapBuffer = function(i, xres, yres )
{
    let oldXres = this.mCubeBuffers[i].mResolution[0];
    let oldYres = this.mCubeBuffers[i].mResolution[1];

    if( this.mCubeBuffers[i].mTexture[0]===null || oldXres !== xres || oldYres !== yres )
    {
        let texture1 = this.mRenderer.CreateTexture(this.mRenderer.TEXTYPE.CUBEMAP,
            xres, yres,
            this.mRenderer.TEXFMT.C4F16,
            this.mRenderer.FILTER.LINEAR,
            this.mRenderer.TEXWRP.CLAMP, 
            null);
        let target1 = this.mRenderer.CreateRenderTargetCubeMap( texture1, null, false);

        let texture2 = this.mRenderer.CreateTexture(this.mRenderer.TEXTYPE.CUBEMAP,
            xres, yres,
            this.mRenderer.TEXFMT.C4F16,
            this.mRenderer.FILTER.LINEAR,
            this.mRenderer.TEXWRP.CLAMP, 
            null);

        let target2 = this.mRenderer.CreateRenderTargetCubeMap( texture2, null, false);

        // Store new buffers
        this.mCubeBuffers[i].mTexture = [texture1,texture2], 
        this.mCubeBuffers[i].mTarget =  [target1, target2 ], 
        this.mCubeBuffers[i].mLastRenderDone = 0;
        this.mCubeBuffers[i].mResolution[0] = xres;
        this.mCubeBuffers[i].mResolution[1] = yres;
    }
}

Effect.prototype.ResizeBuffer = function( i, xres, yres, skipIfNotExists )
{
    if( skipIfNotExists && this.mBuffers[i].mTexture[0]===null ) return;

    let oldXres = this.mBuffers[i].mResolution[0];
    let oldYres = this.mBuffers[i].mResolution[1];

    if( oldXres !== xres || oldYres !== yres )
    {
        let needCopy = (this.mBuffers[i].mTexture[0]!==null);

        let texture1 = this.mRenderer.CreateTexture(this.mRenderer.TEXTYPE.T2D,
            xres, yres,
            this.mRenderer.TEXFMT.C4F32,
            (needCopy) ? this.mBuffers[i].mTexture[0].mFilter : this.mRenderer.FILTER.NONE,
            (needCopy) ? this.mBuffers[i].mTexture[0].mWrap   : this.mRenderer.TEXWRP.CLAMP, 
            null);

        let texture2 = this.mRenderer.CreateTexture(this.mRenderer.TEXTYPE.T2D,
            xres, yres,
            this.mRenderer.TEXFMT.C4F32,
            (needCopy) ? this.mBuffers[i].mTexture[1].mFilter : this.mRenderer.FILTER.NONE,
            (needCopy) ? this.mBuffers[i].mTexture[1].mWrap   : this.mRenderer.TEXWRP.CLAMP, 
            null);

        let target1 = this.mRenderer.CreateRenderTarget( texture1, null, null, null, null, false);
        let target2 = this.mRenderer.CreateRenderTarget( texture2, null, null, null, null, false);

        if( needCopy )
        {
            let v = [0, 0, Math.min(xres, oldXres), Math.min(yres, oldYres)];
            this.mRenderer.SetBlend(false);
            this.mRenderer.SetViewport(v);
            this.mRenderer.AttachShader(this.mProgramCopy);
            let l1 = this.mRenderer.GetAttribLocation(this.mProgramCopy, "pos");
            let vOld = [0, 0, oldXres, oldYres];
            this.mRenderer.SetShaderConstant4FV("v", vOld);

            // Copy old buffers 1 to new buffer
            this.mRenderer.SetRenderTarget(target1);
            this.mRenderer.AttachTextures(1, this.mBuffers[i].mTexture[0], null, null, null);
            this.mRenderer.DrawUnitQuad_XY(l1);

            // Copy old buffers 2 to new buffer
            this.mRenderer.SetRenderTarget(target2);
            this.mRenderer.AttachTextures(1, this.mBuffers[i].mTexture[1], null, null, null);
            this.mRenderer.DrawUnitQuad_XY(l1);

            // Deallocate old memory
            this.mRenderer.DestroyTexture(this.mBuffers[i].mTexture[0]);
            this.mRenderer.DestroyRenderTarget(this.mBuffers[i].mTarget[0]);
            this.mRenderer.DestroyTexture(this.mBuffers[i].mTexture[1]);
            this.mRenderer.DestroyRenderTarget(this.mBuffers[i].mTarget[1]);
            //this.mRenderer.DestroyTexture(this.mBuffers[i].thumbnailTexture);
        }

        // Store new buffers
        this.mBuffers[i].mTexture = [texture1,texture2], 
        this.mBuffers[i].mTarget =  [target1, target2 ], 
        this.mBuffers[i].mLastRenderDone = 0;
        this.mBuffers[i].mResolution[0] = xres;
        this.mBuffers[i].mResolution[1] = yres;
    }
}

Effect.prototype.saveScreenshot = function(passid)
{
    let pass = this.mPasses[passid];

    if( pass.mType === "buffer" )
    {
        let bufferID = assetID_to_bufferID( this.mPasses[passid].mOutputs[0] );

        let texture = this.mBuffers[bufferID].mTarget[ this.mBuffers[bufferID].mLastRenderDone ];

        let numComponents = 3;
        let width = texture.mTex0.mXres;
        let height = texture.mTex0.mYres;
        let type = "Float"; // Other options Float, Half, Uint
        let bytes = new Float32Array(width * height * 4 );//numComponents);
        this.mRenderer.GetPixelDataRenderTarget( texture, bytes, width, height );
        let blob = piExportToEXR(width, height, numComponents, type, bytes);

        // Offer download automatically to the user
        piTriggerDownload("image.exr", blob);
    }
    else if( pass.mType === "cubemap" )
    {
        let xres = 4096;
        let yres = 2048;
        this.mScreenshotSytem.Allocate( xres, yres );

        let cubeBuffer = this.mCubeBuffers[0];

        let target = this.mScreenshotSytem.GetTarget();
        this.mRenderer.SetRenderTarget( target );

        let program = this.mScreenshotSytem.GetProgram();

        this.mRenderer.AttachShader(program);
        let l1 = this.mRenderer.GetAttribLocation(program, "pos");
        this.mRenderer.SetViewport( [0, 0, xres, yres] );
        this.mRenderer.AttachTextures(1, cubeBuffer.mTexture[ cubeBuffer.mLastRenderDone ], null, null, null);
        this.mRenderer.DrawUnitQuad_XY(l1);
        this.mRenderer.DettachTextures();
        this.mRenderer.SetRenderTarget( null );

        let data = new Float32Array(xres*yres*4);
        this.mRenderer.GetPixelDataRenderTarget( target, data, xres, yres );

        let blob = piExportToEXR(xres, yres, 3, "Float", data );
        piTriggerDownload("image.exr", blob);
    }
    else if( pass.mType === "sound" )
    {
        let offset = 0;
        const bits = 16;
        const numChannels = 2;
        let words = new Int16Array(60*pass.mSampleRate*numChannels );

        pass.iRenderSound( new Date(), function(off, data, numSamples)
                                         {
                                            for( let i=0; i<numSamples; i++ )
                                            {
                                                words[offset++] = (data[4*i+0]+256.0*data[4*i+1]) - 32767;
                                                words[offset++] = (data[4*i+2]+256.0*data[4*i+3]) - 32767;
                                            }
                                         }
                                     );

        let blob = piExportToWAV( 60*pass.mSampleRate, pass.mSampleRate, bits, numChannels, words);

        piTriggerDownload("sound.wav", blob);
    }    
}

Effect.prototype.ResizeBuffers = function(xres, yres)
{
    for (let i=0; i<this.mMaxBuffers; i++ )
    {
        this.ResizeBuffer(i, xres, yres, true);
    }
}

Effect.prototype.IsEnabledVR = function ()
{
    if (this.mRenderingStereo) return true;
    return false;
}

Effect.prototype.EnableVR = function()
{
    if( !this.mWebVR.IsSupported() ) return;
    if( this.mRenderingStereo ) return;

    this.mRenderingStereo = true;
    this.mWebVR.Enable();
}

Effect.prototype.DisableVR = function()
{
    if( !this.mWebVR.IsSupported() ) return;
    if( !this.mRenderingStereo ) return;

    this.mRenderingStereo = false;
    this.mWebVR.Disable();
}

Effect.prototype.GetTexture = function( passid, slot ) { return this.mPasses[passid].GetTexture( slot ); }
Effect.prototype.NewTexture = function (passid, slot, url) { return this.mPasses[passid].NewTexture( this.mAudioContext, slot, url, this.mBuffers, this.mCubeBuffers, this.mKeyboard ); }
Effect.prototype.SetOutputs = function( passid, slot, url ) { this.mPasses[passid].SetOutputs( slot, url ); }
Effect.prototype.SetOutputsByBufferID = function( passid, slot, id ) { this.mPasses[passid].SetOutputsByBufferID( slot, id ); }
Effect.prototype.GetAcceptsLinear = function (passid, slot) { return this.mPasses[passid].GetAcceptsLinear(slot); }
Effect.prototype.GetAcceptsMipmapping = function (passid, slot) { return this.mPasses[passid].GetAcceptsMipmapping(slot); }
Effect.prototype.GetAcceptsWrapRepeat = function (passid, slot) { return this.mPasses[passid].GetAcceptsWrapRepeat(slot); }
Effect.prototype.GetAcceptsVFlip = function (passid, slot) { return this.mPasses[passid].GetAcceptsVFlip(slot); }
Effect.prototype.SetSamplerFilter = function (passid, slot, str) { this.mPasses[passid].SetSamplerFilter(slot, str, this.mBuffers, this.mCubeBuffers); }
Effect.prototype.GetTranslatedShaderSource = function (passid) { return this.mPasses[passid].GetTranslatedShaderSource(); }
Effect.prototype.GetSamplerFilter = function (passid, slot) { return this.mPasses[passid].GetSamplerFilter(slot); }
Effect.prototype.SetSamplerWrap = function (passid, slot, str) { this.mPasses[passid].SetSamplerWrap(slot, str, this.mBuffers); }
Effect.prototype.GetSamplerWrap = function (passid, slot) { return this.mPasses[passid].GetSamplerWrap(slot); }
Effect.prototype.SetSamplerVFlip = function (passid, slot, str) { this.mPasses[passid].SetSamplerVFlip(slot, str); }
Effect.prototype.GetSamplerVFlip = function (passid, slot) { return this.mPasses[passid].GetSamplerVFlip(slot); }

Effect.prototype.GetHeaderSize = function (passid)
{
    return this.mPasses[passid].mHeaderLength + 
           this.mRenderer.GetShaderHeaderLines(1);
}

Effect.prototype.ToggleVolume = function()
{
    this.mForceMuted = !this.mForceMuted;

    // outp
    if (this.mForceMuted)
        this.mGainNode.gain.value = 0.0;
    else
        this.mGainNode.gain.value = 1.0;

    // inp
    let num = this.mPasses.length;
    for( let j=0; j<num; j++ )
    {
        for( let i=0; i<this.mPasses[j].mInputs.length; i++ )
        {
            if( this.mForceMuted )
                this.mPasses[j].MuteInput( this.mAudioContext, i );
            else
                this.mPasses[j].UnMuteInput( this.mAudioContext, i );
        }
    }

    return this.mForceMuted;
}

Effect.prototype.SetKeyDown = function( passid, k )
{
    if( this.mKeyboard.mData[ k + 0*256 ] == 255 ) return;

    this.mKeyboard.mData[ k + 0*256 ] = 255;
    this.mKeyboard.mData[ k + 1*256 ] = 255;
    this.mKeyboard.mData[ k + 2*256 ] = 255 - this.mKeyboard.mData[ k + 2*256 ];
    this.mRenderer.UpdateTexture( this.mKeyboard.mTexture, 0, 0, 256, 3, this.mKeyboard.mData );

    let num = this.mPasses.length;
    for (let j=0; j<num; j++ )
    {
        for (let i=0; i<this.mPasses[j].mInputs.length; i++ )
        {
            let inp = this.mPasses[j].mInputs[i];
            if( inp!==null && inp.mInfo.mType==="keyboard" )
            {
                if( this.mTextureCallbackFun!==null )
                    this.mTextureCallbackFun( this.mTextureCallbackObj, i, {mImage:this.mKeyboard.mIcon, mData: this.mKeyboard.mData}, false, 6, 1, -1.0, this.mPasses[j].mID );
            }
        }
    }
}

Effect.prototype.SetKeyUp = function( passid, k )
{
    this.mKeyboard.mData[ k + 0*256 ] = 0;
    this.mKeyboard.mData[ k + 1*256 ] = 0;
    this.mRenderer.UpdateTexture( this.mKeyboard.mTexture, 0, 0, 256, 3, this.mKeyboard.mData );

    let num = this.mPasses.length;
    for (let j=0; j<num; j++ )
    {
        for (let i=0; i<this.mPasses[j].mInputs.length; i++ )
        {
            let inp = this.mPasses[j].mInputs[i];
            if( inp!==null && inp.mInfo.mType==="keyboard" )
            {
                if( this.mTextureCallbackFun!==null )
                    this.mTextureCallbackFun( this.mTextureCallbackObj, i, {mImage:this.mKeyboard.mIcon, mData: this.mKeyboard.mData}, false, 6, 1, -1.0, this.mPasses[j].mID );
            }
        }
    }
}

Effect.prototype.StopOutputs = function()
{
    let wa = this.mAudioContext;

    let num = this.mPasses.length;
    for (let i=0; i<num; i++ )
    {
        this.mPasses[i].StopOutput( wa );
    }
}

Effect.prototype.ResumeOutputs = function()
{
    let wa = this.mAudioContext;

    let num = this.mPasses.length;
    for (let i=0; i<num; i++ )
    {
        this.mPasses[i].ResumeOutput( wa );
    }
}

Effect.prototype.PauseInput = function( passid, id )
{
    return this.mPasses[passid].TooglePauseInput( this.mAudioContext, id );
}

Effect.prototype.ToggleMuteInput = function( passid, id )
{
    return this.mPasses[passid].ToggleMuteInput( this.mAudioContext, id );
}

Effect.prototype.RewindInput = function( passid, id )
{
    this.mPasses[passid].RewindInput( this.mAudioContext, id );
}

Effect.prototype.UpdateInputs = function( passid, forceUpdate )
{
   this.mPasses[passid].UpdateInputs( this.mAudioContext, forceUpdate, this.mKeyboard );
}

Effect.prototype.ResetTime = function()
{
    this.mFrame = 0;
    this.mAudioContext.resume()

    let num = this.mPasses.length;
    for( let i=0; i<num; i++ )
    {
        this.mPasses[i].mFrame = 0;
        for( let j=0; j<this.mPasses[i].mInputs.length; j++ )
            this.mPasses[i].RewindInput(this.mAudioContext, j)
    }
}

Effect.prototype.RequestAnimationFrame = function (id)
{
    if (this.mRenderingStereo && this.mWebVR.IsPresenting())
    {
        this.mWebVR.RequestAnimationFrame(id);
    }
    else
    {
        requestAnimFrame(id);
    }
}

Effect.prototype.Paint = function(time, dtime, fps, mouseOriX, mouseOriY, mousePosX, mousePosY, isPaused)
{
    let wa = this.mAudioContext;
    let da = new Date();
    let vrData = null; if (this.mRenderingStereo) vrData = this.mWebVR.GetData();
    let xres = this.mXres / 1;
    let yres = this.mYres / 1;

    if( this.mFrame===0 )
    {
        for( let i=0; i<this.mMaxBuffers; i++ )
        {
            if( this.mBuffers[i].mTexture[0]!==null )
            {
                this.mRenderer.SetRenderTarget( this.mBuffers[i].mTarget[0] );
                this.mRenderer.Clear( this.mRenderer.CLEAR.Color, [0.0,0.0,0.0,0.0], 1.0, 0   );
                this.mRenderer.SetRenderTarget( this.mBuffers[i].mTarget[1] );
                this.mRenderer.Clear( this.mRenderer.CLEAR.Color, [0.0,0.0,0.0,0.0], 1.0, 0   );
				
				this.mRenderer.CreateMipmaps( this.mBuffers[i].mTexture[0] );
				this.mRenderer.CreateMipmaps( this.mBuffers[i].mTexture[1] );
            }
        }
        for( let i=0; i<this.mMaxCubeBuffers; i++ )
        {
            if( this.mCubeBuffers[i].mTexture[0]!==null )
            {
                for( let face=0; face<6; face++ )
                {
                    this.mRenderer.SetRenderTargetCubeMap( this.mCubeBuffers[i].mTarget[0], face );
                    this.mRenderer.Clear( this.mRenderer.CLEAR.Color, [0.0,0.0,0.0,0.0], 1.0, 0   );
                    this.mRenderer.SetRenderTargetCubeMap( this.mCubeBuffers[i].mTarget[1], face );
                    this.mRenderer.Clear( this.mRenderer.CLEAR.Color, [0.0,0.0,0.0,0.0], 1.0, 0   );
					this.mRenderer.CreateMipmaps( this.mCubeBuffers[i].mTexture[0] );
				    this.mRenderer.CreateMipmaps( this.mCubeBuffers[i].mTexture[1] );
                }
            }
        }
    }

    let num = this.mPasses.length;

    // render sound first
    for( let i=0; i<num; i++ )
    {
        if( this.mPasses[i].mType !== "sound" ) continue;
        if( this.mPasses[i].mProgram===null ) continue;
        this.mPasses[i].Paint( vrData, wa, da, time, dtime, fps, mouseOriX, mouseOriY, mousePosX, mousePosY, xres, yres, isPaused, null, false, this.mBuffers, this.mCubeBuffers, this.mKeyboard, this );
    }

    // render buffers second
    for( let i=0; i<num; i++ )
    {
        if( this.mPasses[i].mType !== "buffer" ) continue;
        if( this.mPasses[i].mProgram===null ) continue;
        let bufferID = assetID_to_bufferID( this.mPasses[i].mOutputs[0] );

        // check if any downstream pass needs mipmaps when reading from this buffer
        let needMipMaps = false;
        for (let j=0; j<num; j++ )
        {
            for (let k=0; k<this.mPasses[j].mInputs.length; k++ )
            {
                let inp = this.mPasses[j].mInputs[k];
                if( inp!==null && inp.mInfo.mType==="buffer" && inp.id === bufferID && inp.mInfo.mSampler.filter === "mipmap")
                {
                    needMipMaps = true;
                    break;
                }
            }
        }

        this.mPasses[i].Paint( vrData, wa, da, time, dtime, fps, mouseOriX, mouseOriY, mousePosX, mousePosY, xres, yres, isPaused, bufferID, needMipMaps, this.mBuffers, this.mCubeBuffers, this.mKeyboard, this );
    }

    // render cubemap buffers second
    for( let i=0; i<num; i++ )
    {
        if( this.mPasses[i].mType !== "cubemap" ) continue;
        if( this.mPasses[i].mProgram===null ) continue;
        let bufferID = 0;//assetID_to_bufferID( this.mPasses[i].mOutputs[0] );

        // check if any downstream pass needs mipmaps when reading from this buffer
        let needMipMaps = false;

        for (let j=0; j<num; j++ )
        {
            for (let k=0; k<this.mPasses[j].mInputs.length; k++ )
            {
                let inp = this.mPasses[j].mInputs[k];
                if( inp!==null && inp.mInfo.mType==="cubemap" )
                {
                    if( assetID_to_cubemapBuferID(inp.mInfo.mID)===0 && inp.mInfo.mSampler.filter === "mipmap" )
                    {
                        needMipMaps = true;
                        break;
                    }
                }
            }
        }

        this.mPasses[i].Paint( vrData, wa, da, time, dtime, fps, mouseOriX, mouseOriY, mousePosX, mousePosY, xres, yres, isPaused, bufferID, needMipMaps, this.mBuffers, this.mCubeBuffers, this.mKeyboard, this );
    }

    // render image last
    for( let i=0; i<num; i++ )
    {
        if( this.mPasses[i].mType !== "image" ) continue;
        if( this.mPasses[i].mProgram===null ) continue;
        this.mPasses[i].Paint( vrData, wa, da, time, dtime, fps, mouseOriX, mouseOriY, mousePosX, mousePosY, xres, yres, isPaused, null, false, this.mBuffers, this.mCubeBuffers, this.mKeyboard, this );
    }   

    // erase keypresses
    for (let k=0; k<256; k++ )
    {
       this.mKeyboard.mData[ k + 1*256 ] = 0;
    }
    this.mRenderer.UpdateTexture( this.mKeyboard.mTexture, 0, 0, 256, 3, this.mKeyboard.mData );

    if( this.mRenderingStereo ) this.mWebVR.Finish();

    this.mFrame++;
}

Effect.prototype.NewShader = function( passid, preventCache, onResolve )
{
    let commonSourceCodes = [];
    for (let i=0; i<this.mPasses.length; i++ )
    {
        if( this.mPasses[i].mType==="common")
        {
            commonSourceCodes.push(this.mPasses[i].mSource);
        }
    }

    this.mPasses[passid].NewShader(commonSourceCodes, preventCache, onResolve );
}

Effect.prototype.GetNumPasses = function()
{
    return this.mPasses.length;
}

Effect.prototype.GetNumOfType = function(passtype)
{
    let id = 0;
    for (let j=0; j<this.mPasses.length; j++ )
    {
        if( this.mPasses[j].mType===passtype )
        {
            id++;
        }
    }
    return id;
}

Effect.prototype.GetPassType = function( id ) { return this.mPasses[id].mType; }
Effect.prototype.GetPassName = function( id ) { return this.mPasses[id].mName; }
Effect.prototype.GetCode = function( id ) { return this.mPasses[id].mSource; }
Effect.prototype.SetCode = function( id, source ) { this.mPasses[id].SetCode(source); }
Effect.prototype.GetError = function (id) { return this.mPasses[id].mError; }
Effect.prototype.GetErrorStr = function (id) { return this.mPasses[id].mErrorStr; }
Effect.prototype.GetErrorGlobal = function()
{
    for (let i = 0; i < this.mPasses.length; i++)
    {
        if (this.mPasses[i].mError)
        {
            return true;
        }
    }
    return false;
}

Effect.prototype.Load = function (jobj )
{
    if (jobj.ver !== "0.1")
    {
        console.log("Wrong Format");
        return false;
    }

    let numPasses = jobj.renderpass.length;

    if( numPasses<1 || numPasses>this.mMaxPasses )
    {
        console.log("Corrupted Shader - " + numPasses);
        return false;
    }

    this.mPasses = [];
    for (let j = 0; j < numPasses; j++)
    {
        let rpass = jobj.renderpass[j];

        // skip sound passes if in thumbnail mode
        if( this.mForceMuted && rpass.type === "sound" ) continue;

        let wpass = new EffectPass(this.mRenderer, this.mIs20, this.mIsLowEnd, this.mShaderTextureLOD,
                                   this.mTextureCallbackFun, this.mTextureCallbackObj, this.mForceMuted, this.mForcePaused, this.mGainNode,
                                   this.mProgramDownscale, j, this);

        wpass.Create(rpass.type, this.mAudioContext);

        let numInputs = rpass.inputs.length;

        for (let i = 0; i < 4; i++)
        {
            wpass.NewTexture(this.mAudioContext, i, null, null, null);
        }
        for (let i = 0; i < numInputs; i++)
        {
            let lid  = rpass.inputs[i].channel;
            let styp = rpass.inputs[i].type;
            let sid  = rpass.inputs[i].id;
            let ssrc = rpass.inputs[i].filepath;
            let psrc = rpass.inputs[i].previewfilepath;
            let samp = rpass.inputs[i].sampler;

            wpass.NewTexture(this.mAudioContext, lid, { mType: styp, mID: sid, mSrc: ssrc, mSampler: samp, mPreviewSrc: psrc }, this.mBuffers, this.mCubeBuffers, this.mKeyboard);
        }

        for (let i = 0; i < 4; i++)
        {
            wpass.SetOutputs(i, null);
        }

        let numOutputs = rpass.outputs.length;
        for (let i = 0; i < numOutputs; i++)
        {
            let outputID = rpass.outputs[i].id;
            let outputCH = rpass.outputs[i].channel;
            wpass.SetOutputs(outputCH, outputID);
        }

        // create some hardcoded names. This should come from the DB
        let rpassName = "";
        if (rpass.type === "common" ) rpassName = "Common";
        if (rpass.type === "sound"  ) rpassName = "Sound";
        if (rpass.type === "image"  ) rpassName = "Image";
        if (rpass.type === "buffer") rpassName = "Buffer " + String.fromCharCode(65 + assetID_to_bufferID(wpass.mOutputs[0]));
        if (rpass.type === "cubemap") rpassName = "Cube A";// " + String.fromCharCode(65 + assetID_to_bufferID(this.mPasses[j].mOutputs[0]));
        wpass.SetName(rpassName);
        wpass.SetCode(rpass.code);

        this.mPasses.push(wpass);
    }
    return true;
}

Effect.prototype.CompileSome = function ( passes, preventCache, onResolve )
{
    let me = this;

    let to = getRealTime();
    let allPromisses = [];
    for (let j = 0; j < passes.length; j++)
    {
        allPromisses.push(new Promise(function (resolve, reject)
        {
            me.NewShader(passes[j], preventCache, function () { resolve(1); });
        }));
    }

    // aggregated callback when all passes have been compiled
    Promise.all(allPromisses).then(function (values)
    {
        let totalError = false;
        for (let j = 0; j < me.mPasses.length; j++)
        {
            if (me.mPasses[j].mError)
            {
                totalError = true;
                break;
            }
        }
        me.mCompilationTime = getRealTime() - to;
        onResolve(!totalError);
    }).catch(console.log);
}

Effect.prototype.Compile = function (preventCache, onResolve )
{
    let me = this;

    let to = getRealTime();
    let allPromisses = [];
    let numPasses = this.mPasses.length;
    for (let j = 0; j < numPasses; j++)
    {
        allPromisses.push(new Promise(function (resolve, reject)
        {
            me.NewShader(j, preventCache, function () { resolve(1); });
        }));
    }

    // aggregated callback when all passes have been compiled
    Promise.all(allPromisses).then(function (values)
    {
        let totalError = false;
        for (let j = 0; j < numPasses; j++)
        {
            if (me.mPasses[j].mError)
            {
                totalError = true;
                break;
            }
        }
        me.mCompilationTime = getRealTime() - to;
        onResolve(!totalError);
    }).catch(console.log);
}

Effect.prototype.GetCompilationTime = function( id )
{
    return this.mPasses[id].GetCompilationTime()/1000.0;
}
Effect.prototype.GetTotalCompilationTime = function()
{
    return this.mCompilationTime/1000.0;
}

Effect.prototype.DestroyPass = function( id )
{
   this.mPasses[id].Destroy( this.mAudioContext );
   this.mPasses.splice(id, 1);
}

Effect.prototype.AddPass = function( passType, passName, onResolve )
{
    let shaderStr = null;

    if( passType==="sound"   ) shaderStr = "vec2 mainSound( int samp, float time )\n{\n    // A 440 Hz wave that attenuates quickly overt time\n    return vec2( sin(6.2831*440.0*time)*exp(-3.0*time) );\n}";
    if( passType==="buffer"  ) shaderStr = "void mainImage( out vec4 fragColor, in vec2 fragCoord )\n{\n    fragColor = vec4(0.0,0.0,1.0,1.0);\n}";
    if( passType==="common"  ) shaderStr = "vec4 someFunction( vec4 a, float b )\n{\n    return a+b;\n}";
    if( passType==="cubemap" ) shaderStr = "void mainCubemap( out vec4 fragColor, in vec2 fragCoord, in vec3 rayOri, in vec3 rayDir )\n{\n    // Ray direction as color\n    vec3 col = 0.5 + 0.5*rayDir;\n\n    // Output to cubemap\n    fragColor = vec4(col,1.0);\n}";

    let id = this.GetNumPasses();
    this.mPasses[id] = new EffectPass( this.mRenderer, this.mIs20, this.mIsLowEnd, this.mShaderTextureLOD,
                                       this.mTextureCallbackFun, this.mTextureCallbackObj, this.mForceMuted, this.mForcePaused, this.mGainNode, 
                                       this.mProgramDownscale, id, this );

    this.mPasses[id].Create( passType, this.mAudioContext );
    this.mPasses[id].SetName( passName );
    this.mPasses[id].SetCode( shaderStr );
    this.NewShader(id, false, function ()
    {
        onResolve();
    });

    return { mId : id, mShader : shaderStr };
}

// this should be removed once we have MultiPass 2.0 and passes render to arbitrary buffers
Effect.prototype.IsBufferPassUsed = function( bufferID )
{
    for (let j=0; j<this.mPasses.length; j++ )
    {
        if( this.mPasses[j].mType !== "buffer" ) continue;
        if( this.mPasses[j].mOutputs[0] === bufferID_to_assetID(bufferID) ) return true;
    }
    return false;
}

Effect.prototype.Save = function()
{
    var result = {};

    result.ver = "0.1";

    result.renderpass = [];

    let numPasses = this.mPasses.length;
    for (let j=0; j<numPasses; j++ )
    {
        result.renderpass[j] = {};

        result.renderpass[j].outputs = new Array();
        for (let i = 0; i<4; i++ )
        {
            let outputID = this.mPasses[j].mOutputs[i];
            if( outputID===null ) continue;
            result.renderpass[j].outputs.push( { channel: i, id: outputID } );
        }
        result.renderpass[j].inputs = new Array();
        for (let i = 0; i<4; i++ )
        {
            if( this.mPasses[j].mInputs[i]===null ) continue;
            result.renderpass[j].inputs.push( {channel: i,
                                               type    : this.mPasses[j].mInputs[i].mInfo.mType,
                                               id      : this.mPasses[j].mInputs[i].mInfo.mID,
                                               filepath: this.mPasses[j].mInputs[i].mInfo.mSrc,
                                               sampler : this.mPasses[j].mInputs[i].mInfo.mSampler });
        }

        result.renderpass[j].code = this.mPasses[j].mSource;
        result.renderpass[j].name = this.mPasses[j].mName
        result.renderpass[j].description = "";
        result.renderpass[j].type = this.mPasses[j].mType;
    }

    result.flags = this.calcFlags();

    return result;
}

Effect.prototype.calcFlags = function ()
{
    let flagVR = false;
    let flagWebcam = false;
    let flagSoundInput = false;
    let flagSoundOutput = false;
    let flagKeyboard = false;
    let flagMultipass = false;
    let flagMusicStream = false;

    let numPasses = this.mPasses.length;
    for (let j = 0; j < numPasses; j++)
    {
        let pass = this.mPasses[j];

        if (pass.mType === "sound") flagSoundOutput = true;
        if (pass.mType === "buffer") flagMultipass = true;

        for (let i = 0; i < 4; i++)
        {
            if (pass.mInputs[i] === null) continue;

            if (pass.mInputs[i].mInfo.mType === "webcam") flagWebcam = true;
            else if (pass.mInputs[i].mInfo.mType === "keyboard") flagKeyboard = true;
            else if (pass.mInputs[i].mInfo.mType === "mic") flagSoundInput = true;
            else if (pass.mInputs[i].mInfo.mType === "musicstream") flagMusicStream = true;
        }

        let n1 = pass.mSource.indexOf("mainVR(");
        let n2 = pass.mSource.indexOf("mainVR (");
        if (n1 > 0 || n2 > 0) flagVR = true;
    }

    return {
        mFlagVR: flagVR,
        mFlagWebcam: flagWebcam,
        mFlagSoundInput: flagSoundInput,
        mFlagSoundOutput: flagSoundOutput,
        mFlagKeyboard: flagKeyboard,
        mFlagMultipass: flagMultipass,
        mFlagMusicStream: flagMusicStream
    };
}</script>
    <script>"use strict"

const kMaxCompileTime = 10.0;

function iReportCrash(shaderID)
{
    let req = new XMLHttpRequest();
    req.onload = function ()
    {
        let jsn = req.response;
        if (jsn === null) return;
        if (jsn.result === 0)
        {
            // yep
        }
    };
    req.open("POST", "/shadertoy", true);
    req.responseType = "json";
    req.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    req.send( "s=" + shaderID + "&r=2" );
}
</script>
    <script>"use strict"

var gActive = -1;
var mShaders = [];
var gNumCanvases = 0;

function myrefresh( id, slot, img, forceFrame, gui, guiID, renderID, time )
{
    if( mShaders[id].mReady===false ) return;
    if( forceFrame )
    {
        if (mShaders[id].mScreenshot === false)
        {
            mShaders[id].gEffect.Paint(mShaders[id].mTime / 1000.0, 1.0 / 60.0, 60.0, 0, 0, 0, 0, false);
        }
    }
}

function startRendering()
{
    if( gActive<0 ) return;
    if( mShaders[gActive].mReady===false ) return;
    if( mShaders[gActive].mScreenshot===true ) return;

    let time = getRealTime();

    mShaders[gActive].mFPS.Count( time );
    mShaders[gActive].mTime = mShaders[gActive].mTime0 + (time - mShaders[gActive].mTo);
    let dtime = 1000.0/60.0;
    mShaders[gActive].gEffect.Paint( mShaders[gActive].mTime/1000.0, dtime/1000.0, mShaders[gActive].mFPS.GetFPS(), 0,0,0,0, false);

    requestAnimFrame( startRendering );
}

function iLoadAndCompile(jsn, i )
{
    var shaderObj = jsn[i];
    if (shaderObj === null) return;

    var resizeCB = function (xres, yres) { myrefresh(i, 0, null, true, false, 0, -1.0) };
    var crashCB = function () { alert('crash');/*iReportCrash(gShaderIDs[i])*/ };
    mShaders[i].gEffect = new Effect(null, null, mShaders[i].mPreview.mCanvas, myrefresh, i, true, true, resizeCB, crashCB);

    if (!mShaders[i].gEffect.Load(shaderObj)) return;

    mShaders[i].gEffect.Compile(false, function (worked)
    {
        if (worked === true)
        {
            previewShowRender(mShaders[i].mPreview);

            mShaders[i].mScreenshot = false;
            mShaders[i].mReady = true;
            mShaders[i].mTime = 10.0 * 1000.0;
            mShaders[i].mTime0 = 0.0;
            mShaders[i].mTo = 0.0;
            mShaders[i].mFPS = piCreateFPSCounter();
            mShaders[i].mPreview.mCanvas.addEventListener("mouseout", function (ev) { gActive = -1; }, true);
            mShaders[i].mPreview.mBase.addEventListener("mouseover", function (ev) { if (mShaders[i].mPreview.mUI !== null) mShaders[i].mPreview.mUI.classList.add('isVisible'); }, true);
            mShaders[i].mPreview.mBase.addEventListener("mouseout", function (ev) { if (mShaders[i].mPreview.mUI !== null) mShaders[i].mPreview.mUI.classList.remove('isVisible'); }, true);
            mShaders[i].mPreview.mCanvas.addEventListener("mouseover", function (ev)
            {
                let ele = piGetSourceElement(ev);
                if (ele.mId === undefined) return;

                gActive = ele.mId;
                if (!mShaders[gActive].mReady) return;
                let time = getRealTime();
                mShaders[gActive].mTo = time;
                mShaders[gActive].mTime0 = mShaders[gActive].mTime;
                mShaders[gActive].mFPS.Reset(time);

                startRendering();
            }, true);


            /*
            let compilationTime = mShaders[i].gEffect.GetTotalCompilationTime();
            if (compilationTime > kMaxCompileTime)
            {
                iReportCrash(mShaders[i].mShaderID);
            }*/

            myrefresh(i, null, null, true, false, 0, -1.0);
        }
        else
        {
            mShaders[i].mReady = false;
            previewShowError(mShaders[i].mPreview);
        }
    });
};


function iProcessShader( jsn, i )
{
    var shaderObj = jsn[i];
    if( shaderObj===null ) return;

    if ((shaderObj.info.usePreview === 0 && !gUseScreenshots) || (mShaders[i].mPreviewReady !== 1))
    {
        iLoadAndCompile(jsn, i);
    }
    else
    {
        mShaders[i].mScreenshot = true;
        if( shaderObj.info.usePreview === 1 )
            previewShowScreenshot(mShaders[i].mPreview, 1); // comp
        else if (gUseScreenshots)
            previewShowScreenshot(mShaders[i].mPreview, 2); // sett
    }

    if( i<(jsn.length-1) ) setTimeout( function(){iProcessShader(jsn,i+1);}, 10 );
}

function iInitUI(numCanvases, uiCallback, windowTitle)
{
    gNumCanvases = numCanvases;
    document.getElementById("mySearch").focus();

    //-----------------------------------------------------------------
    // window
    //-----------------------------------------------------------------
    if (windowTitle !== null) {
        document.title = windowTitle;
    }

    //-----------------------------------------------------------------
    // ui
    //-----------------------------------------------------------------
    var num = Math.min(gShaders.length, gNumCanvases);

    //var base = document.getElementsByClassName( "searchResult" );

    for (let i = 0; i < gNumCanvases; i++)
    {
        let pv = createPreview(i);

        if (i >= num) {
            previewHide(pv);
            continue;
        }

        let shaderID = gShaders[i].info.id;
        
        if (pv.mUI !== null && uiCallback !== null) {
            pv.mUI.addEventListener('click', function (ev) {
                uiCallback(shaderID);
                ev.preventDefault();
            }, false);
        }
        
        previewShowLoading(pv);
        
        mShaders[i] = {};
        mShaders[i].mShaderID = shaderID;
        mShaders[i].mPreview = pv;
        mShaders[i].mScreenshot = false;
        mShaders[i].mPreview.mLink.href = "/view/" + shaderID;
        mShaders[i].mPreviewReady = 0;
        mShaders[i].mReady = false;
        mShaders[i].gEffect = null;

        previewLoadScreenshot(mShaders[i].mPreview,
            function () { mShaders[i].mPreviewReady = 1; if (mShaders[i].mReady === false) previewShowScreenshot(mShaders[i].mPreview, 0); },
            function () { mShaders[i].mPreviewReady = 2; },
            shaderID);
    }

    if (num <= 0) {
        return;
    }
}

function iInitShaders(jsn)
{
    for (let i = 0; i < jsn.length; i++)
    {
        let shaderObj = jsn[i];
        if (shaderObj === null) continue;
        let inf = shaderObj.info;
        mShaders[i].mPreview.mTextA.textContent = inf.name;
        mShaders[i].mPreview.mTextB.innerHTML = "<a class='user' href='/user/" + htmlEntities(inf.username) + "'>" + htmlEntities(inf.username) + "</a>";
        mShaders[i].mPreview.mTextC.innerHTML = "<img src='/img/themes/" + gThemeName + "/views.png' class='viewsIcon'></img>" + inf.viewed + "    &nbsp;&nbsp;  <img src='/img/themes/" + gThemeName + "/likes.png' class='likesIcon'></img>" + inf.likes;
    }

    setTimeout(function () { iProcessShader(jsn, 0); }, 10);
}

function resultsInitStatic(numCanvases, uiCallback, windowTitle)
{
    iInitUI(numCanvases, uiCallback, windowTitle);

    iInitShaders(gShaders);
}

function resultsInit(numCanvases, uiCallback, windowTitle)
{	
    iInitUI(numCanvases, uiCallback, windowTitle);

    var num = Math.min(gShaderIDs.length, gNumCanvases);

    var mHttpReq = new XMLHttpRequest();

    mHttpReq.abort();

    var str = "{ \"shaders\" : [";
    for( let i=0; i<num; i++ )
    {
         str += "\"" + gShaderIDs[i] + "\"";
         if( i!==(num-1) ) str += ", ";
    }
    str += "] }";

    str = "s=" + encodeURIComponent( str ) + "&nt=0&nl=0&np=0";

    mHttpReq.open( "POST", "/shadertoy", true );
    mHttpReq.responseType = "json";
    mHttpReq.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    mHttpReq.onload = function ()
    {
        let jsn = this.response;
        if( jsn===null )
        {
            console.log( "Could not load shaders" );
            return;
        }

        iInitShaders(jsn);
    }
    mHttpReq.send( str );
}</script>
    <style>
    .shaderPreview
    {
    display: block;
    background-color: #000000;
    background-image: url("/img/loading.gif");
    background-repeat: no-repeat;
    background-position: center;
    padding: 0px;
    margin: 0px;
    border: 0px solid #000000;
    border-radius: 8px;
    width:100%;
    height:100%;
    position: absolute;
    overflow:hidden;
    }

    .previewInfo
    {
    width: 100%;
    left: 0px;
    top: 2px;
    position: relative;
    visibility: hidden;
    }

    .previewCanvas
    {
    left: 0px;
    top: 0px;
    padding: 0px;
    margin: 0px;
    position: absolute;
    cursor: pointer;
    width:100%;
    height:100%;
    border-radius: 8px;
    border: 0px solid #000000;
    backgroundColor: transparent;
visibility: hidden;
opacity:0;
transition: opacity 1.0s ease;
    }

    .previewText
    {
        text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 1px;
    }

    .previewTextUser
    {
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-left: 3px;
    }

    .previewStats
    {
    padding-right: 1px;
    right: 0px;
    top: 0px;
    position: absolute;
    }

    .previewErrorContainer
    {
    left:0px;
    top:0px;
    width:100%;
    height:100%;
    padding:0px;
    margin:0px;
    background-color:#000000;
    border-radius:8px;
    cursor:pointer;
    visibility:hidden;
    }

    .previewErrorMessage
    {
    top:50%;
    position:absolute;
    width:100%;
    text-align:center;
    padding:0;
    margin:auto;
    color:#ff0000;
    font-size:2em;
    font-style:italic;
    }

    .previewNoGLContainter
    {
    left:0px;
    top:0px;
    width:100%;
    height:100%;
    padding:0px;
    margin:0px;
    position:absolute;
    background-color:#000000;
    border-radius:8px;
    cursor:pointer;
    pointer-events:none;
    visibility:hidden;
    font-size:2em;
    }

    .previewNoGLMessage
    {
    width:86%;
    height:90%;
    padding-left:7%;
    padding-right:7%;
    padding-top:10%;
    padding-bottom:0px;
    color:#ff0000;
    position:absolute;
    visibility:hidden;
    }

    .previewThumbnailContainer
    {
    width:100%;
    height:100%;
    left:0px;
    top:0px;
    padding:0px;
    margin:0px;
    position:absolute;
    cursor:pointer;
    visibility:hidden;
    border-radius:8px;
    border:0px solid #000000;
    }

    .previewThumbnailImage
    {
    width:100%;
    height:100%;
    left:0px;
    top:0px;
    padding:0px;
    margin:0px;
    position:absolute;
    cursor:pointer;
    border-radius:8px;
    border:0px solid #000000;
opacity: 0.0;
transition: opacity 1.0s ease;
    }

    .previewThumbnailIcon
    {
    width:64px;
    height:32px;
    left:0px;
    top:0px;
    padding:0px;
    padding-top:12px;
    margin:0px;
    position:absolute;
    color:#ffffff;
    background-color:#ff8020;
    font-weight:bold;
    border-radius:0px 0px 8px 0px;
    text-align:center;
    //visibility:hidden;
    }


    .previewUIContainter
    {
    display: block;
    right:0px;
    top:0px;
    padding:0px;
    margin:0px;
    position:absolute;
    //cursor:pointer;
    //pointer-events:none;
    //visibility:hidden;
    }
</style>

<script>
    function previewHide(me)
    {
    me.mBase.style.visibility = "hidden";
    me.mCanvas.style.visibility = "hidden";
    me.mCanvas2D.style.visibility = "hidden";
    me.mNoWebGL.style.visibility = "hidden";
    me.mError.style.visibility = "hidden";
    me.mCont.style.visibility = "hidden";
    }

    function previewShowRender(me)
    {
    me.mBase.style.visibility = "visible";
    me.mCanvas.style.visibility = "visible";
me.mCanvas.style.opacity = 1.0;
    me.mCanvas.style.borderRadius ="8px;";
//  me.mCanvas2D.style.visibility = "hidden";
    me.mNoWebGL.style.visibility = "hidden";
    me.mError.style.visibility = "hidden";
    me.mCont.style.visibility = "visible";
    }

    function previewShowScreenshot(me, message)
    {
    me.mBase.style.visibility = "visible";
    me.mCanvas.style.visibility = "hidden";
    me.mCanvas2D.style.visibility = "visible";
me.mThumbnailImg.style.opacity = 1.0;
    me.mNoWebGL.style.visibility = "hidden";
    me.mError.style.visibility = "hidden";
    me.mCont.style.visibility = "visible";
    me.mThumbnailWar1.style.visibility = (message===1)?"visible":"hidden";
    me.mThumbnailWar2.style.visibility = (message===2)?"visible":"hidden";
    }

    function previewShowLoading(me)
    {
    me.mBase.style.visibility = "visible";
    me.mCanvas.style.visibility = "hidden";
    me.mCanvas2D.style.visibility = "hidden";
    me.mNoWebGL.style.visibility = "hidden";
    me.mError.style.visibility = "hidden";
    me.mCont.style.visibility = "hidden";

    me.mLink.style.visibility = "visible";
    me.mBase.style.backgroundColor = "#ff0000;"
    me.mCont.style.visibility = "visible";
    }

    function previewShowNoWebGL(me, shaderID)
    {
    me.mBase.style.visibility = "visible";
    me.mCanvas.style.visibility = "hidden";
    me.mCanvas2D.style.visibility = "hidden";
    me.mNoWebGL.style.visibility = "visible";
    me.mError.style.visibility = "visible";
    me.mThumbnailImgNoWebGL.onerror = function(ev) 
                                      { 
                                            me.mThumbnailImgNoWebGL.style.visibility="hidden"; 
                                            me.mMessageNoWebGL.style.visibility="visible"; 
                                      };
    me.mThumbnailImgNoWebGL.src = "/media/shaders/" + shaderID + ".jpg";
    }

    function previewShowError(me)
    {
    me.mBase.style.visibility = "visible";
    me.mCanvas.style.visibility = "hidden";
    me.mCanvas2D.style.visibility = "hidden";
    me.mNoWebGL.style.visibility = "hidden";
    me.mError.style.visibility = "visible";
    me.mCont.style.visibility = "visible";
    }

    function previewLoadScreenshot( me, cbSuccess, cbError, shaderID )
    {
    var url = "/media/shaders/" + shaderID + ".jpg";
    me.mThumbnailImg.onload = cbSuccess;
    me.mThumbnailImg.onerror = function(ev) { cbError(); };
    me.mThumbnailImg.src = url;
    }
        
    function createPreview(id)
    {
        var bar = document.getElementById( "Preview_"+id+"_Canvas" );
        bar.width = bar.offsetWidth;
        bar.height = bar.offsetHeight;
        bar.mId = id;

        return { mBase: document.getElementById( "Preview_"+id+"_Container" ),
        mLink: document.getElementById( "Preview_"+id+"_Link" ),
        mCanvas: bar,
        mCont: document.getElementById( "Preview_"+id+"_Info" ),
        mTextA: document.getElementById( "Preview_"+id+"_Text" ),
        mTextB: document.getElementById( "Preview_"+id+"_TextUser" ),
        mTextC: document.getElementById( "Preview_"+id+"_Stats" ),
        mNoWebGL: document.getElementById( "Preview_"+id+"_NoWebGL" ),
        mError: document.getElementById( "Preview_"+id+"_Error" ),
        mCanvas2D: document.getElementById( "Preview_"+id+"_Thumnail" ),
        mThumbnailImg: document.getElementById( "Preview_"+id+"_ThumnailImage" ),
        mThumbnailWar1: document.getElementById( "Preview_"+id+"_ThumnailWarning1" ),
        mThumbnailWar2: document.getElementById( "Preview_"+id+"_ThumnailWarning2" ),
        mThumbnailImgNoWebGL: document.getElementById( "Preview_"+id+"_ThumnailImageNoWebGL" ),
        mMessageNoWebGL: document.getElementById( "Preview_"+id+"_MessageNoWebGL"),
        mUI: document.getElementById( "Preview_"+id+"_UI" )
        };
    }
</script>


    <style>
        .grayText
        {
            color: #606060;
            font-weight:normal;
        }
        .boldText
        {
            color: #000000;
        }
        .normalText
        {
            color: #606060;
            font-size:1.5em;
            padding-bottom:8px;
            
        }
        .bigText
        {
            font-size:5.0em;
            padding-left:4%; padding-right:4%; 
            padding-bottom:48px; 
        }
        .contributors 
        {
            font-size:1.2em;
            padding-left:4%; padding-right:4%; 
            padding-top:48px;
        }

        .contributorsHead
        {
            padding-right:0.2em;
            font-size:1.75em;
        }

        div#blockTop
        {
            width:100%;
            padding:0px;
            padding-top:24px;
            margin:0px;
            display:flex;
            flex-wrap:wrap;
            justify-content: space-between;
            align-content:center;
            align-items:center;
        }
        div#block0  
        {
            align-self: flex-start;
            width:48%;
        }
        div#block1
        {
            width:48%;
            height:100%;
            display:flex;
            flex-direction:column;
            justify-content:space-between;
            align-items: center;
            flex-wrap:nowrap;
        }

        div#blockBottom
        {
            width:100%;
            padding:0px;
            padding-top: 32px;
            margin:0px;
        }

        div#blockPreviews
        {
            width:100%;
        
            padding:0px;
            margin:0px;
            display:flex;
            justify-content:space-between;
            flex-wrap:wrap;
            flex-direction:row;
        }

        .shaderBig
        {
            margin: 0px;
            padding: 0px;
            width: 100%;
        }

        .shaderSmall
        {
            margin: 0px;
            padding: 0px;
            width: 20%;
            padding-bottom: 32px;
        }

        .shaderPreviewContainer
        {
            width: 100%;
            padding-bottom:56.25%;
            height: 0;
            position: relative;
        }

        

    /* ----------------------- media resolutions ------------------------ */
    @media screen and (max-width:799px) 
    {
        div#block0, div#block1 { width:100%; padding-bottom: 16px; }
        .bigText { font-size:3em;  padding-left:16px; padding-right:16px; padding-top:24px; padding-bottom:24px; }
        .contributorsHead { font-size:1.75em; }
        .contributors { font-size:1em; padding-left:16px; padding-right:16px; padding-top:24px; padding-bottom:24px; }
        div#blockBottom { flex-direction:column; }
        .shaderSmall { width:100%; }
        div#donations { flex-direction: column; }
        div#donate-button-container { padding-bottom:8px; padding-right:0px; }
    }
    @media screen and (min-width:800px) and (max-width:1279px)
    {
        .contributorsHead { font-size:1.5em; }
        .bigText { font-size:3.5em; padding-bottom:24px; }
        .contributors { padding-top:24px; }
        div#donations { flex-direction: column; }
        div#donate-button-container { padding-bottom:8px; padding-right:0px;}
    }
    </style>

    <script>
    "use strict"
    var gShaders = [{"ver":"0.1","info":{"id":"lffSRN","date":"1705267208","viewed":5645,"name":"Quanta half","username":"liamegan","description":"Doctor Who vibes","likes":70,"published":1,"flags":32,"usePreview":0,"tags":[]},"renderpass":[{"inputs":[{"id":"4dXGR8","filepath":"\/media\/previz\/buffer00.png","previewfilepath":"\/media\/previz\/buffer00.png","type":"buffer","channel":0,"sampler":{"filter":"linear","wrap":"clamp","vflip":"true","srgb":"false","internal":"byte"},"published":1}],"outputs":[{"id":"4dfGRr","channel":0}],"code":"  void mainImage( out vec4 c, in vec2 f ) {\n    c = texture(iChannel0,f\/iResolution.xy);\n  }","name":"Image","description":"","type":"image"},{"inputs":[{"id":"4dXGR8","filepath":"\/media\/previz\/buffer00.png","previewfilepath":"\/media\/previz\/buffer00.png","type":"buffer","channel":0,"sampler":{"filter":"linear","wrap":"clamp","vflip":"true","srgb":"false","internal":"byte"},"published":1}],"outputs":[{"id":"4dXGR8","channel":0}],"code":"\n  \/* Shading constants *\/\n  \/* --------------------- *\/\n  const vec3 LP = vec3(0, 0, 0);  \/\/ light position\n  const vec3 LC = vec3(.85,0.80,0.70);    \/\/ light colour\n  const vec3 HC1 = vec3(.5, .4, .3);      \/\/ hemisphere light colour 1\n  const vec3 HC2 = vec3(0.1,.1,.6)*.5;    \/\/ hemisphere light colour 2\n  const vec3 HLD = vec3(0,1,0);           \/\/ hemisphere light direction\n  const vec3 BC = vec3(0.25,0.25,0.25);   \/\/ back light colour\n  const vec3 FC = vec3(1.30,1.20,1.00);   \/\/ fresnel colour\n  const float AS = .5;                    \/\/ ambient light strength\n  const float DS = 1.;                    \/\/ diffuse light strength\n  const float BS = .3;                    \/\/ back light strength\n  const float FS = .3;                    \/\/ fresnel strength\n  \/* Raymarching constants *\/\n  \/* --------------------- *\/\n  const float MAX_TRACE_DISTANCE = 50.;             \/\/ max trace distance\n  const float INTERSECTION_PRECISION = 0.0001;       \/\/ precision of the intersection\n  const int NUM_OF_TRACE_STEPS = 256;               \/\/ max number of trace steps\n  const float STEP_MULTIPLIER = 1.;                 \/\/ the step mutliplier - ie, how much further to progress on each step\n  \n  \/* Structures *\/\n  \/* ---------- *\/\n  struct Camera {\n    vec3 ro;\n    vec3 rd;\n    vec3 forward;\n    vec3 right;\n    vec3 up;\n    float FOV;\n  };\n  struct Surface {\n    float len;\n    vec3 position;\n    vec3 colour;\n    float id;\n    float steps;\n    float AO;\n  };\n  struct Model {\n    float dist;\n    vec3 colour;\n    float id;\n  };\n  \n  \/* RNG *\/\n  \/* ---------- *\/\n  \/\/ Hash without sine from Dave Hoskins\n  \/\/ https:\/\/www.shadertoy.com\/view\/4djSRWa\n  float hash12(vec2 p) {\n\tvec3 p3  = fract(vec3(p.xyx) * .1031);\n    p3 += dot(p3, p3.yzx + 33.33);\n    return fract((p3.x + p3.y) * p3.z);\n  }\n  vec2 hash22(vec2 p) {\n\tvec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));\n    p3 += dot(p3, p3.yzx+33.33);\n    return fract((p3.xx+p3.yz)*p3.zy);\n  }\n  \n  \n  \/* Utilities *\/\n  \/* ---------- *\/\n  vec2 toScreenspace(in vec2 p) {\n    vec2 uv = (p - 0.5 * iResolution.xy) \/ min(iResolution.y, iResolution.x);\n    return uv;\n  }\n  mat2 R(float a) {\n    float c = cos(a);\n    float s = sin(a);\n    return mat2(c, -s, s, c);\n  }\n  Camera getCamera(in vec2 uv, in vec3 pos, in vec3 target) {\n    vec3 f = normalize(target - pos);\n    vec3 r = normalize(vec3(f.z, 0., -f.x));\n    vec3 u = normalize(cross(f, r));\n    \n    float FOV = .6;\n    \n    return Camera(\n      pos,\n      normalize(f + FOV * uv.x * r + FOV * uv.y * u),\n      f,\n      r,\n      u,\n      FOV\n    );\n  }\n  \/\/ folding from gaz: https:\/\/www.shadertoy.com\/view\/4tX3DS\n  vec2 fold(vec2 p, float a) {\n      p.x=abs(p.x);\n      vec2 n = vec2(cos(a),sin(a));\n      for(int i = 0; i < 2; ++i)\n      {\n          p -= 2.*min(0.,dot(p,n))*n;\n          n = normalize(n-vec2(1.,0.));\n      }\n      return p;\n  }\n  vec3 path(in float delta) {\n    return vec3(cos(delta*.1) * 4.2 + sin((delta) * .3) * .5*cos(delta * .05), sin(delta * .04) * 5.4+cos(delta * .04) * 5.4, delta);\n  }\n  \n  #define PI 3.14159236\n  #define SCALE 2.5\n  \n  \n  \/\/--------------------------------\n  \/\/ Modelling\n  \/\/--------------------------------\n  Model model(vec3 p) {\n    float d = length(p)-.4;\n    \n    p.xy -= path(p.z).xy;\n    float m=length(p.xy)*.5;\n    float z = p.z;\n    float r = cos(z*.2+sin(m)*.3)*.4+.5;\n    float r2 = (sin(z*.05124)*cos(z*.025203))+1.;\n    p*=SCALE;\n    \n    vec3 q=p;\n    p=vec3(R(0.05*p.z+r)*p.xy, p.z);\n    p.xy=fold(p.xy,PI\/6.+z*.2);\n    p=mod(p,3.)-1.5;\n    \n    vec3 o = abs(p); \n    o-=(o.x+o.y+o.z)*0.33333;\n    float d0=max(o.x,max(o.y,o.z))-0.01;\n    float d1=length(q.xy)-1.-r2*2.;\n    d0=max(d0,-d1);\n    d0=max(d0,length(q.xy)-4.-r2*2.);\n    d=length( vec2(abs(d0), length(mod(p,vec3(.1))-.05)) )-.3*r;\n    \n    vec3 colour = mix(mix(vec3(.8,.3,.6), vec3(.3,.9,.9), vec3(cos(z*.1)*.5+.5, sin(z*.12)*.5+.5, cos(z*.05+1.)*.5+.5)), vec3(1.,.6,.4)*.1, m);\n    return Model(d\/SCALE, colour, 1.);\n  }\n  Model map( vec3 p ){\n    return model(p);\n  }\n  \n  \/* Modelling utilities *\/\n  \/* ---------- *\/\n  \/\/ I *think* I borrowed this from Shane, but probably orginally comes from IQ. \n  \/\/ Calculates the normal by taking a very small distance,\n  \/\/ remapping the function, and getting normal for that\n  vec3 calcNormal( in vec3 pos ){\n    vec3 eps = vec3( 0.001, 0.0, 0.0 );\n    vec3 nor = vec3(\n      map(pos+eps.xyy).dist - map(pos-eps.xyy).dist,\n      map(pos+eps.yxy).dist - map(pos-eps.yxy).dist,\n      map(pos+eps.yyx).dist - map(pos-eps.yyx).dist );\n    return normalize(nor);\n  }\n  \n  \/\/--------------------------------\n  \/\/ Raymarcher\n  \/\/--------------------------------\n  Surface march( in Camera cam ){\n    float h = 1e4; \/\/ local distance\n    float d = 0.; \/\/ ray depth\n    float id = -1.; \/\/ surace id\n    float s = 0.; \/\/ number of steps\n    float ao = 0.; \/\/ march space AO. Simple weighted accumulator. Not really AO, but \u00af\\_(\u30c4)_\/\u00af\n    vec3 p; \/\/ ray position\n    vec3 c; \/\/ surface colour\n\n    for( int i=0; i< NUM_OF_TRACE_STEPS ; i++ ) {\n      if( abs(h) < INTERSECTION_PRECISION || d > MAX_TRACE_DISTANCE ) break;\n      p = cam.ro+cam.rd*d;\n      Model m = map( p );\n      h = m.dist;\n      d += h * STEP_MULTIPLIER;\n      id = m.id;\n      s += 1.;\n      ao += max(h, 0.);\n      c = m.colour;\n    }\n\n    if( d >= MAX_TRACE_DISTANCE ) id = -1.0;\n\n    return Surface( d, p, c, id, s, ao );\n  }\n  \n  \/\/--------------------------------\n  \/\/ Shading\n  \/\/--------------------------------\n  \/*\n   * Soft shadows and AO curtesy of Inigo Quilez\n   * https:\/\/iquilezles.org\/articles\/rmshadows\n  *\/\n  float softshadow( in vec3 ro, in vec3 rd, in float mint, in float tmax ) {\n    float res = 1.0;\n    float t = mint;\n    for( int i=0; i<16; i++ ) {\n      float h = map( ro + rd*t ).dist;\n      res = min( res, 8.0*h\/t );\n      t += clamp( h, 0.02, 0.10 );\n      if( h<0.001 || t>tmax ) break;\n    }\n    return clamp( res, 0.0, 1.0 );\n  }\n  float AO( in vec3 pos, in vec3 nor ) {\n    float occ = 0.0;\n    float sca = 1.0;\n    for( int i=0; i<5; i++ )\n    {\n      float hr = 0.01 + 0.12*float(i)\/4.0;\n      vec3 aopos =  nor * hr + pos;\n      float dd = map( aopos ).dist;\n      occ += -(dd-hr)*sca;\n      sca *= 0.95;\n    }\n    return clamp( 1.0 - 3.0*occ, 0.0, 1.0 );    \n  }\n  vec3 shade(vec3 col, vec3 pos, vec3 nor, vec3 ref, Camera cam) {\n    \n    vec3 plp = LP - pos; \/\/ point light\n    \n    float o = AO( pos, nor );                 \/\/ Ambient occlusion\n    vec3  l = normalize( plp );                    \/\/ light direction\n    \n    float d = clamp( dot( nor, l ), 0.0, 1.0 )*DS;   \/\/ diffuse component\n    float b = clamp( dot( nor, normalize(vec3(-l.x,0,-l.z))), 0.0, 1.0 )*clamp( 1.0-pos.y,0.0,1.0)*BS; \/\/ back light component\n    float f = pow( clamp(1.0+dot(nor,cam.rd),0.0,1.0), 2.0 )*FS; \/\/ fresnel component\n\n    vec3 c = vec3(0.0);\n    c += d*LC;                           \/\/ diffuse light integration\n    c += mix(HC1,HC2,dot(nor, HLD))*AS;        \/\/ hemisphere light integration (ambient)\n    c += b*BC*o;       \/\/ back light integration\n    c += f*FC*o;       \/\/ fresnel integration\n    \n    return col*c;\n  }\n  vec3 render(Surface surface, Camera cam, vec2 uv) {\n    vec3 colour = vec3(.04,.045,.05);\n    colour = vec3(.1, .0, .3);\n    vec3 colourB = vec3(.1, .05, .2);\n    \n    vec2 pp = uv;\n    \n    colour = mix(colourB, colour, pow(length(pp), 2.)\/1.5);\n    vec3 bg = colour;\n\n      vec3 surfaceNormal = calcNormal( surface.position );\n      vec3 ref = reflect(cam.rd, surfaceNormal);\n      colour = surfaceNormal;\n      vec3 pos = surface.position;\n      \n      vec3 col = surface.colour;\n      \n      colour = shade(col, pos, surfaceNormal, ref, cam);\n    \n    \n    float sceneLength = length(cam.ro - surface.position);\n    float fog = smoothstep(MAX_TRACE_DISTANCE, -3., sceneLength);\n    colour = mix(bg, colour, pow(fog, 2.));\n    \n    \n    colour *= clamp(1.\/(surface.steps*.02), .2, 10.);\n\n\n    return colour;\n  }\n  \n  \n  void mainImage( out vec4 c, in vec2 f ) {\n    vec2 uv = toScreenspace(f.xy);\n    \n    float t = iTime*5.;\n    vec3 la = path(t+.5);\n    Camera cam = getCamera(uv, path(t), la);\n    \n    vec2 a = sin(vec2(1.5707963, 0) - path(la.z).x\/8.); \n    mat2 rM = mat2(a, -a.y, a.x);\n    cam.rd.xy *= rM;\n    \n    Surface surface = march(cam);\n    \n    vec3 r = render(surface, cam, uv);\n    \n    c = texture(iChannel0,f\/iResolution.xy)*.8;\n    vec4 c2 = vec4(r,1);\n    c = clamp(mix(c+c2, c2*2., clamp(surface.len*.05, 0., 1.)), vec4(0.), vec4(1));\n  }\n","name":"Buffer A","description":"","type":"buffer"}]},{"ver":"0.1","info":{"id":"XstXR2","date":"1460331501","viewed":8083,"name":"Windows 95","username":"ungzd","description":"Waving logo of Windows 95","likes":85,"published":3,"flags":0,"usePreview":0,"tags":[]},"renderpass":[{"inputs":[],"outputs":[{"id":"4dfGRr","channel":0}],"code":"#ifdef GL_ES\nprecision mediump float;\n#endif\n\n#define PI 3.1415926535897932384626433832795\n\nconst float wave_amplitude = 0.076;\nconst float period = 2.*PI;\n\nfloat wave_phase() {\n    return iTime;\n}\n\nfloat square(vec2 st) {\n    vec2 bl = step(vec2(0.), st);       \/\/ bottom-left\n    vec2 tr = step(vec2(0.),1.0-st);   \/\/ top-right\n    return bl.x * bl.y * tr.x * tr.y;\n}\n\nvec4 frame(vec2 st) {\n    float tushka = square(st*mat2((1.\/.48), 0., 0., (1.\/.69)));\n    \n    mat2 sector_mat = mat2(1.\/.16, 0., 0., 1.\/.22);\n    float sectors[4];\n    sectors[0] = square(st * sector_mat + (1.\/.16)*vec2(0.000,-0.280));\n    sectors[1] = square(st * sector_mat + (1.\/.16)*vec2(0.000,-0.060));\n    sectors[2] = square(st * sector_mat + (1.\/.16)*vec2(-0.240,-0.280));\n    sectors[3] = square(st * sector_mat + (1.\/.16)*vec2(-0.240,-0.060));\n    vec3 sector_colors[4];\n    sector_colors[0] = vec3(0.941, 0.439, 0.404) * sectors[0];\n    sector_colors[1] = vec3(0.435, 0.682, 0.843) * sectors[1];\n    sector_colors[2] = vec3(0.659, 0.808, 0.506) * sectors[2];\n    sector_colors[3] = vec3(0.996, 0.859, 0.114) * sectors[3];\n    \n    return vec4(vec3(sector_colors[0] + sector_colors[1] +\n                     sector_colors[2] + sector_colors[3]), tushka);\n}\n\nvec4 trail_piece(vec2 st, vec2 index, float scale) {\n    scale = index.x * 0.082 + 0.452;\n    \n    vec3 color;\n    if (index.y > 0.9 && index.y < 2.1 ) {\n        color = vec3(0.435, 0.682, 0.843);\n        scale *= .8;\n    } else if (index.y > 3.9 && index.y < 5.1) {\n        color = vec3(0.941, 0.439, 0.404);\n        scale *= .8;\n    } else {\n        color = vec3(0., 0., 0.);\n    }\n    \n    float scale1 = 1.\/scale;\n    float shift = - (1.-scale) \/ (2. * scale);\n    vec2 st2 = vec2(vec3(st, 1.) * mat3(scale1, 0., shift, 0., scale1, shift, 0., 0., 1.));\n    float mask = square(st2);\n\n    return vec4( color, mask );\n}\n\nvec4 trail(vec2 st) {\n    \/\/ actually 1\/width, 1\/height\n    const float piece_height = 7. \/ .69;\n    const float piece_width = 6. \/ .54;\n  \n    \/\/ make distance between smaller segments slightly lower\n    st.x = 1.2760 * pow(st.x, 3.0) - 1.4624 * st.x*st.x + 1.4154 * st.x;\n    \n    float x_at_cell = floor(st.x*piece_width)\/piece_width;\n    float x_at_cell_center = x_at_cell + 0.016;\n    float incline = cos(0.5*period + wave_phase()) * wave_amplitude;\n    \n    float offset = sin(x_at_cell_center*period + wave_phase())* wave_amplitude + \n        incline*(st.x-x_at_cell)*5.452;\n    \n    float mask = step(offset, st.y) * (1.-step(.69+offset, st.y)) * step(0., st.x);\n    \n    vec2 cell_coord = vec2((st.x - x_at_cell) * piece_width,\n                           fract((st.y-offset) * piece_height));\n    vec2 cell_index = vec2(x_at_cell * piece_width, \n                           floor((st.y-offset) * piece_height));\n    \n    vec4 pieces = trail_piece(cell_coord, cell_index, 0.752);\n    \n    return vec4(vec3(pieces), pieces.a * mask);\n}\n\nvec4 logo(vec2 st) {\n    if (st.x <= .54) {\n        return trail(st);\n    } else {\n        vec2 st2 = st + vec2(0., -sin(st.x*period + wave_phase())*wave_amplitude);\n        return frame(st2 + vec2(-.54, 0));\n    }\n}\n\nvoid mainImage( out vec4 fragColor, in vec2 fragCoord ) {\n    vec2 st = fragCoord.xy\/iResolution.xy;\n    st.x *= iResolution.x\/iResolution.y;\n\n    st += vec2(.0);\n    st *= 1.472;\n    st += vec2(-0.7,-0.68);\n    float rot = PI*-0.124;\n    st *= mat2(cos(rot), sin(rot), -sin(rot), cos(rot));\n    vec3 color = vec3(1.);\n    \n    vec4 logo_ = logo(st);    \n    fragColor = mix(vec4(0.,.5,.5,1.000), logo_, logo_.a);\n}","name":"Image","description":"","type":"image"}]},{"ver":"0.1","info":{"id":"ls3SRr","date":"1457308908","viewed":5037,"name":"LoopingSpline","username":"Bers","description":"A cheap, classic Catmull-Rom. Useful for object property animation (camera path, etc). The distance field itself is not the point here, although it is a nice way to visualize the resulting spline.","likes":70,"published":3,"flags":0,"usePreview":0,"tags":[]},"renderpass":[{"inputs":[],"outputs":[{"id":"4dfGRr","channel":0}],"code":"\/\/ Author : S\u00c3\u00a9bastien B\u00c3\u00a9rub\u00c3\u00a9\n\/\/ Created : Oct 2014\n\/\/ Modified : Jan 2016\n\/\/\n\/\/ A quick & simple spline implementation to use in ShaderToy.\n\/\/ The spline end folds on the start, making a cyclic path.\n\/\/ Computation is reasonably cheap (<.5 ms to solve a value at time=t on my old laptop).\n\/\/ The distance field, however, is more expensive to compute (iterative process).\n\/\/\n\/\/ Useful for object property animation (camera path, speed, position, size, color, roughness, etc).\n\/\/ The distance field itself is not the point here, albeit a nice way to visualize the resulting spline.\n\/\/\n\/\/ Note 1 : There is no support for random array index access (only textures\/resources), therefore the function\n\/\/ \"PointArray()\" was coded.\n\/\/\n\/\/ Note 2 : Works with float, vec2, vec3, vec4. Just replace the type. Packaging multiple properties to animate into\n\/\/          a vec4 is most probably more efficient than calling the vec2 function twice with different control points.\n\/\/\n\/\/ License : Creative Commons Non-commercial (NC) license\n\/\/\nconst int POINT_COUNT = 8;\nstruct CtrlPts\n{\n    vec2 p[POINT_COUNT];\n};\nvec2 PointArray(int i, CtrlPts ctrlPts)\n{\n    if(i==0 || i==POINT_COUNT  ) return ctrlPts.p[0];\n    if(i==1 || i==POINT_COUNT+1) return ctrlPts.p[1];\n    if(i==2 || i==POINT_COUNT+2) return ctrlPts.p[2];\n    if(i==3) return ctrlPts.p[3];\n    if(i==4) return ctrlPts.p[4];\n    if(i==5) return ctrlPts.p[5];\n    if(i==6) return ctrlPts.p[6];\n    if(i==7) return ctrlPts.p[7];\n    return vec2(0);\n}\n\nvec2 catmullRom(float fTime, CtrlPts ctrlPts)\n{\n    float t = fTime;\n    const float n = float(POINT_COUNT);\n    \n    int idxOffset = int(t*n);\n    vec2 p1 = PointArray(idxOffset,ctrlPts);\n    vec2 p2 = PointArray(idxOffset+1,ctrlPts);\n    vec2 p3 = PointArray(idxOffset+2,ctrlPts);\n    vec2 p4 = PointArray(idxOffset+3,ctrlPts);\n    \n    \/\/For some reason, fract(t*n) returns garbage on my machine with small values of t.\n    \/\/return fract(n*t);\n    \/\/Using this below yields the same results, minus the glitches.\n    t *= n;\n    t = (t-float(int(t)));\n    \n    \/\/A classic catmull-rom\n    \/\/e.g.\n    \/\/http:\/\/steve.hollasch.net\/cgindex\/curves\/catmull-rom.html\n    \/\/http:\/\/www.lighthouse3d.com\/tutorials\/maths\/catmull-rom-spline\/\n    vec2 val = 0.5 * ((-p1 + 3.*p2 -3.*p3 + p4)*t*t*t\n               + (2.*p1 -5.*p2 + 4.*p3 - p4)*t*t\n               + (-p1+p3)*t\n               + 2.*p2);\n    return val;\n}\n\nfloat distanceToLineSeg(vec2 p, vec2 a, vec2 b)\n{\n    \/\/e = capped [0,1] orthogonal projection of ap on ab\n    \/\/       p\n    \/\/      \/\n    \/\/     \/\n    \/\/    a--e-------b\n    vec2 ap = p-a;\n    vec2 ab = b-a;\n    vec2 e = a+clamp(dot(ap,ab)\/dot(ab,ab),0.0,1.0)*ab;\n    return length(p-e);\n}\n\nvec2 debugDistanceField(vec2 uv, CtrlPts ctrlPts)\n{\n    \/\/This is just to illustrate the resulting spline. A Spline distance field should not be computed this way.\n    \/\/If the real intent was to show a distance field, something like this perhaps should be used:\n    \/\/https:\/\/www.shadertoy.com\/view\/XsX3zf\n    const float MAX_DIST = 10000.0;\n    float bestX = 0.0;\n    \n    \/\/Primary (rough) estimate : decent results with 2 lines per control point (faint blue lines)\n    const int iter = POINT_COUNT*2+1;\n    \/\/const int iter = POINT_COUNT*1+1; \/\/<-Faster\n    \/\/const int iter = POINT_COUNT*3+1; \/\/<-Nicer\n    float primarySegLength = 1.0\/float(iter-1);\n    vec2 pA = catmullRom(0., ctrlPts);\n    float minRoughDist = MAX_DIST;\n    float x = 0.0;\n    for(int i=0; i < iter; ++i)\n    {\n        vec2 pB = catmullRom(x, ctrlPts);\n        \n        float d = distanceToLineSeg(uv, pA, pB);\n        pA = pB;\n        if(d<minRoughDist)\n        {\n            bestX = x;\n            minRoughDist = d;\n        }\n         \n        x += primarySegLength;\n        x = min(x,0.99999); \/\/<1 To prevent artifacts at the end.\n    }\n    \n    \/\/Secondary (smooth) estimate : refine (red curve)\n    const int iter2 = 14;\n    x = max(bestX-1.25*primarySegLength,0.0); \/\/Starting 25% back on previous seg (50% overlap total)\n    float minDist = MAX_DIST;\n    pA = catmullRom(x, ctrlPts);\n    for(int i=0; i < iter2; ++i)\n    {\n        vec2 pB = catmullRom(x, ctrlPts);\n        float d = distanceToLineSeg(uv, pA, pB);\n        pA = pB;\n        \n        if(d<minDist)\n        {\n            bestX = x;\n            minDist = d;\n        }\n         \n        \/\/Covering 1.5x primarySegLength (50% overlap with prev, next seg)\n        x += 1.5\/float(iter2-1)*primarySegLength;\n        x = min(x,0.99999); \/\/<1 To prevent artifacts at the end.\n    }\n    \n    \n    return vec2(minDist,minRoughDist);\n}\n\n\/\/Recenters and scales in the [0-1] range.\nvec2 getUV(vec2 px)\n{\n    vec2 uv = px \/ iResolution.xx;\n    return uv;\n}\n\nvoid mainImage( out vec4 fragColor, in vec2 fragCoord )\n{\n    CtrlPts ctrlPts;\n\tctrlPts.p[0] = vec2(0.10,0.25);\n    ctrlPts.p[1] = vec2(0.2,0.1);\n    ctrlPts.p[2] = vec2(0.6,0.35);\n    ctrlPts.p[3] = vec2(0.4,0.1);\n    ctrlPts.p[4] = vec2(0.8,0.35);\n    ctrlPts.p[5] = vec2(0.6,0.55);\n    ctrlPts.p[6] = vec2(0.5,0.45);\n    ctrlPts.p[7] = vec2(0.3,0.49);\n    \n    if(iMouse.z > 0.1)\n        ctrlPts.p[2] = getUV(iMouse.xy);\n    vec2 uv = getUV(fragCoord.xy);\n    \n    float fTime = iTime*0.15;\n    vec2 pA = catmullRom(fract(fTime), ctrlPts);\n    vec2 pB = catmullRom(fract(fTime+0.02), ctrlPts);\n    \n    \/\/Compute Distance field\n    vec2 dSeg = debugDistanceField(uv, ctrlPts);\n    \n    \/\/Draw distance field background\n    vec3 c = vec3(dSeg.x*7.0+smoothstep(0.20,0.3,abs(fract(dSeg.x*20.0)-0.5)));\n    \n    \/\/Draw the spline\n    c = mix(vec3(0,0.8,0.9),c,smoothstep(-0.005,0.0035,dSeg.y));\n    c = mix(vec3(1,0  ,0.0),c,smoothstep(0.0,0.0025,dSeg.x));\n    \n    \/\/Draw each control point\n    float minDistP = 10000.0;\n    for(int i=0; i < POINT_COUNT; ++i)\n    {\n        vec2 ctrl_pt = PointArray(i,ctrlPts);\n        minDistP = min(length(uv-ctrl_pt),minDistP);\n    }\n    c = mix(vec3(0,0,1),c,smoothstep(0.008,0.011,minDistP));\n    \n    \/\/Draw moving points\n    c = mix(vec3(0,0.7,0),c,smoothstep(0.008,0.011,length(uv-pA)));\n    c = mix(vec3(0,0.7,0),c,smoothstep(0.008,0.011,length(uv-pB)));\n    c = mix(vec3(1,1,1),c,smoothstep(0.004,0.006,length(uv-pB)));\n\t\n    fragColor = vec4(c,1);\n}","name":"Image","description":"","type":"image"}]},{"ver":"0.1","info":{"id":"llfXW8","date":"1436264672","viewed":5338,"name":"Butterfly Flock","username":"kuvkar","description":"Flock of butterflies flying around. Mouse to look around.","likes":46,"published":1,"flags":0,"usePreview":0,"tags":[]},"renderpass":[{"inputs":[{"id":"XsX3zn","filepath":"\/media\/a\/94284d43be78f00eb6b298e6d78656a1b34e2b91b34940d02f1ca8b22310e8a0.png","previewfilepath":"\/media\/ap\/94284d43be78f00eb6b298e6d78656a1b34e2b91b34940d02f1ca8b22310e8a0.png","type":"cubemap","channel":1,"sampler":{"filter":"linear","wrap":"clamp","vflip":"false","srgb":"false","internal":"byte"},"published":1},{"id":"Xsf3zn","filepath":"\/media\/a\/f735bee5b64ef98879dc618b016ecf7939a5756040c2cde21ccb15e69a6e1cfb.png","previewfilepath":"\/media\/ap\/f735bee5b64ef98879dc618b016ecf7939a5756040c2cde21ccb15e69a6e1cfb.png","type":"texture","channel":0,"sampler":{"filter":"mipmap","wrap":"repeat","vflip":"false","srgb":"false","internal":"byte"},"published":1}],"outputs":[],"code":"mat3 rotx(float a) { mat3 rot; rot[0] = vec3(1.0, 0.0, 0.0); rot[1] = vec3(0.0, cos(a), -sin(a)); rot[2] = vec3(0.0, sin(a), cos(a)); return rot; }\nmat3 roty(float a) { mat3 rot; rot[0] = vec3(cos(a), 0.0, sin(a)); rot[1] = vec3(0.0, 1.0, 0.0); rot[2] = vec3(-sin(a), 0.0, cos(a)); return rot; }\nmat3 rotz(float a) { mat3 rot; rot[0] = vec3(cos(a), -sin(a), 0.0); rot[1] = vec3(sin(a), cos(a), 0.0); rot[2] = vec3(0.0, 0.0, 1.0); return rot; }\n\nconst float mouseRotateSpeed = 5.0;\n\nstruct sdObject\n{\n    vec3 pos;\n    float rad;\n    int index;\n};\n\n\/\/ Amount of butterflies    \n#define OBJECTS 40\n    \nsdObject sdObjects[OBJECTS];    \n\n\/\/ objects that will be potentially hit, found at prestep\n#define CACHED 5\nsdObject cachedObjects[CACHED];\n\nint maxCacheIndex = 0;\n    \n\/\/ distance functions from https:\/\/iquilezles.org\/articles\/distfunctions\n\nfloat udBox( vec3 p, vec3 b )\n{\n  return length(max(abs(p)-b,0.0));\n}\n\nfloat sdHexPrism( vec3 p, vec2 h )\n{\n    vec3 q = abs(p);\n    return max(q.z-h.y,max((q.x*0.866025+q.y*0.5),q.y)-h.x);\n}\n\/\/\/\/ \n\nconst float MATERIAL_BODY = 0.0;\nconst float MATERIAL_WING = 1.0;\n\n\nconst float OBJECT_SIZE = 0.5;    \nvec2 getModel(in vec3 pos, int index)\n{\n    float phase = float(index);\n    float l = length(pos);\n\t\n    float bl = (sin(pos.z * 12.0 - 5.0) * 0.5 + 0.5) + 0.3;\n    float body = sdHexPrism(pos - vec3(0.0, 0.0, 0.), vec2(OBJECT_SIZE * 0.04 * bl, OBJECT_SIZE * 0.2));         \n\n    float wx = max(abs(l * 6. + .2) - .4, 0.0);\n    float sl = 1.5* abs(sin(wx)) + 0.05;\n    \n    vec3 wing = vec3(OBJECT_SIZE * 0.5, OBJECT_SIZE * 0.01, OBJECT_SIZE * 0.25 * sl);\n    \n    float w1 = udBox(rotz(sin(iTime * 22.0 + phase)) * pos - vec3(OBJECT_SIZE * 0.5, OBJECT_SIZE * 0., 0.0), wing);\n    float w2 = udBox(rotz(-sin(iTime * 22.0 + phase)) * pos + vec3(OBJECT_SIZE * 0.5, OBJECT_SIZE * 0., 0.0), wing);\n    \n    float id = MATERIAL_BODY;\n    if(w1 < body || w2 < body)\n    {\n        id = MATERIAL_WING;\n    }\n    \n    float m = min(body, w1);\n    m = min(m, w2);\n    \n    return vec2(m, id);\n            \n}\n\n\nvec2 map(in vec3 rp, in sdObject[CACHED] objects, inout vec3 localPos, inout int index)\n{\n    float m = 9999.0;\n    vec2 ret = vec2(m, 0.0);\n    \n    for (int i = 0; i < CACHED; ++i)\n    {\n        if ( i <= maxCacheIndex)\n        {\n            vec3 lp = rp - objects[i].pos;\n            vec2 mat = getModel(lp, objects[i].index);     \n            float a = min(mat.x, m);\n            if (a < m)\n            {\n                m = a;\n                ret = mat;\n                localPos = lp;\n                index = objects[i].index;\n            }\n        }\n    }\n    return ret;\n}\n\n\/**\n * In the pre-step function I find objects that will be potentially hit.\n * I will check only against these objects at later steps.\n *\/\nfloat prestep(in vec3 ro, in vec3 rp, in vec3 rd, in vec3 rd90degXAxis, in vec3 rd90degYAxis)\n{\n    maxCacheIndex = -1;\n    float m = 99999.0;\n    for (int i = 0; i < OBJECTS; ++i)\n    {\n        vec3 sp = -ro + sdObjects[i].pos;\n        \n        float distToPlaneY = abs(dot(rd90degYAxis, sp));\n    \tfloat distToPlaneX = abs(dot(rd90degXAxis, sp));\n        \n        float distanceToPlanes = max(distToPlaneY, distToPlaneX);\n        distanceToPlanes = distanceToPlanes - sdObjects[i].rad;\n\n        vec2 mat = getModel(rp - sdObjects[i].pos * (1.0 + distanceToPlanes), sdObjects[i].index);\n        float l = mat.x;\n        m = min(m, l);\n        \n        if(distanceToPlanes <= 0.0 && ++maxCacheIndex < CACHED)\n        {\n            if (maxCacheIndex == 0) cachedObjects[0] = sdObjects[i];\n            else if (maxCacheIndex == 1) cachedObjects[1] = sdObjects[i];\n            else if (maxCacheIndex == 2) cachedObjects[2] = sdObjects[i];\n            else if (maxCacheIndex == 3) cachedObjects[3] = sdObjects[i];\n            else if (maxCacheIndex == 4) cachedObjects[4] = sdObjects[i];\n            else return m;    \n            \n        }\n    }\n    \n    return m;\n}\n\n\n\nvoid trace(in vec3 rp, in vec3 rd, inout vec4 color)\n{\n    vec3 ro = rp;\n    float travel = 0.0;\n    const int STEPS = 50;\n    \/\/ build orthonormal frame to get right and up vectors to be used in distance calculations \n    vec3 tmp = normalize(cross(rd, vec3(0.0, 1.0, 0.0)));\n    vec3 up = normalize(cross(rd, tmp));\n    vec3 right = cross(rd, up);\n    \n    \/\/ pre-step and move ray\n    travel = prestep(ro, rp, rd, right, up);\n    rp += travel * rd;\n    \n    vec3 local = vec3(0.0);\n    int hitindex = 0;\n    \n    for (int i = 0; i < STEPS; ++i)\n    {\n       vec2 mat = map(rp, cachedObjects, local, hitindex);\n       float dist = mat.x;\n        \n       if(dist <= 0.0)\n       {\n           float id = mat.y;\n           float indx = float(hitindex);\n           float c1 = sin(indx * 0.1) * 0.5 + 0.5;\n           float c2 = abs(cos(abs(local.z * 15.0)) + sin(abs(local.x) * 15.0));\n           float c3 = cos(indx * 0.4);\n           color = vec4(mat.y, c2 * mat.y, c1 * mat.y, 1.0) * abs(sin(indx * 0.1));\n           color.a = 1.0;\n               \n           return;\n       }\n       float dst = max(0.01, dist);\n       travel += dst;\n       rp += rd * dst;\n       if(travel > 30.0) return;\n    }\n}\n\n\n\nvoid mainImage( out vec4 fragColor, in vec2 fragCoord )\n{\n    fragColor = vec4(0.0);\n\tvec2 uv = fragCoord.xy \/ iResolution.xy;\n    uv -= vec2(0.5);\n    uv.y \/= iResolution.x \/ iResolution.y;\n    vec2 mouse = iMouse.xy \/ iResolution.xy;\n    mouse -= vec2(0.5);\n    \n    if(mouse.xy == vec2(-0.5))\n    {\n        mouse = vec2(0.0);\n    }\n    \n    mouse *= mouseRotateSpeed;\n    \n    for (int i = 0; i < OBJECTS; ++i)\n    {\n        vec3 p = (texture(iChannel0, sin(iTime * 0.001) + 0.21 * vec2(float(i))) - vec4(0.5)).rgb;\n        p *= roty(iTime * 2.0);\n        p.z += (sin(iTime) * 0.5 + 0.5) * 1.0;\n        p.x *= 1.0 + (sin(iTime * 0.1) * 0.5 + 0.5) * 0.25;\n        p.y *= 1.0 + (cos(iTime * 0.1) * 0.5 + 0.5) * 0.25;\n        sdObjects[i] = sdObject(p * 10.0, OBJECT_SIZE * 1. , i);\n    }\n    \n    vec3 rp = vec3(0.0, .0, 1.0);\n    vec3 rd = normalize(vec3(uv, 0.3));\n    \n    rd *= rotx(mouse.y);\n    rd *= roty(mouse.x);\n    \n    trace(rp, rd, fragColor);\n    fragColor = mix(fragColor, texture(iChannel1, rd * roty(3.14159 * 0.5)), 1.0 - fragColor.a);\n    \n    float luma = (fragColor.r + fragColor.g + fragColor.b) * 0.33;\n    fragColor -= (luma) * vec4(.9, .5, .0, 1.) * clamp(rd.y - 0.05, 0.0, 1.0);\n    \n    fragColor += vec4(.2, 0.4, 0.0, 0.0) * abs(clamp(rd.y, -1.0, .0));\n\t\n    \/\/ frame\n    fragColor = mix(fragColor, vec4(0.0), 1.0 - smoothstep(0.5, 0.45, abs(uv.x)));\n    fragColor = mix(fragColor, vec4(0.0), 1.0 - smoothstep(0.28, 0.2, abs(uv.y)));\n    \n}","name":"","description":"","type":"image"}]},{"ver":"0.1","info":{"id":"4tcXRr","date":"1477599524","viewed":14462,"name":"Alien Core","username":"glkt","description":"A weird alien core, using raymarching. Click to turn around. \nTry changing the texture, there are interesting patterns to find...","likes":186,"published":3,"flags":0,"usePreview":1,"tags":[]},"renderpass":[{"inputs":[{"id":"XdXGzr","filepath":"\/media\/a\/8979352a182bde7c3c651ba2b2f4e0615de819585cc37b7175bcefbca15a6683.jpg","previewfilepath":"\/media\/ap\/8979352a182bde7c3c651ba2b2f4e0615de819585cc37b7175bcefbca15a6683.jpg","type":"texture","channel":0,"sampler":{"filter":"mipmap","wrap":"repeat","vflip":"true","srgb":"false","internal":"byte"},"published":1}],"outputs":[{"id":"4dfGRr","channel":0}],"code":"\/\/ GLKITTY 2016.\n\nvec3 rotateY(vec3 v, float t){\n    float cost = cos(t); float sint = sin(t);\n    return vec3(v.x * cost + v.z * sint, v.y, -v.x * sint + v.z * cost);\n}\n\nfloat smin( float a, float b, float k )\n{\n    float h = clamp( 0.5+0.5*(b-a)\/k, 0.0, 1.0 );\n    return mix( b, a, h ) - k*h*(1.0-h);\n}\n\nfloat noise(vec3 p){\n    \n    float t = iTime;\n    vec3 np = normalize(p);\n    \n    \/\/ kind of bi-planar mapping\n    float a = texture(iChannel0,t\/20.+np.xy).x;      \n    float b = texture(iChannel0,t\/20.+.77+np.yz).x;\n    \n    a = mix(a,.5,abs(np.x));\n    b = mix(b,.5,abs(np.z));\n    \n    float noise = a+b-.4;    \n    noise = mix(noise,.5,abs(np.y)\/2.);\n        \n    return noise;\n}\n\nfloat map(vec3 p){\n    \n    \/\/ spheres\n    float d = (-1.*length(p)+3.)+1.5*noise(p);    \n    d = min(d, (length(p)-1.5)+1.5*noise(p) );  \n    \n    \/\/ links\n    float m = 1.5; float s = .03;    \n    d = smin(d, max( abs(p.x)-s, abs(p.y+p.z*.2)-.07 ) , m);          \n    d = smin(d, max( abs(p.z)-s, abs(p.x+p.y\/2.)-.07 ), m );    \n    d = smin(d, max( abs(p.z-p.y*.4)-s, abs(p.x-p.y*.2)-.07 ), m );    \n    d = smin(d, max( abs(p.z*.2-p.y)-s, abs(p.x+p.z)-.07 ), m );    \n    d = smin(d, max( abs(p.z*-.2+p.y)-s, abs(-p.x+p.z)-.07 ), m );\n    \n    return d;\n}\n\nfloat color( vec3 p){\n   return 0.; \n}\n\nvoid mainImage( out vec4 fragColor, in vec2 fragCoord )\n{    \n    \/\/ Ray from UV\n\tvec2 uv = fragCoord.xy * 2.0 \/ iResolution.xy - 1.0;\n    uv.x *= iResolution.x \/ iResolution.y;\n    vec3 ray = normalize(vec3(1.*uv.x,1.*uv.y,1.));\n    \n    \/\/ Color    \n    vec3 color = vec3(0);    \n    const int rayCount = 1024;\n    \n    \/\/ Raymarching\n    float t = 0.;\n    for (int r = 1; r <= rayCount; r++)\n    {\n        \/\/ Ray Position\n        vec3 p = vec3(0,0,-3.) + ray * t;        \n        \n        \/\/ Rotation \n       \tp = rotateY(p, iMouse.x\/iResolution.x * 2.* 3.14);  \n        p = rotateY(p,iTime\/3.);\n        \n        \/\/ Deformation \n    \tfloat mask = max(0.,(1.-length(p\/3.)));\n    \tp = rotateY(p,mask*sin(iTime\/2.)*1.2);        \n        p.y += sin(iTime+p.x)*mask*.5;\n        p *= 1.1+(sin(iTime\/2.)*mask*.3);\n\n        \/\/ distance\n        float d =  map(p);   \n        \n        \/\/color\n        if(d<0.01 || r == rayCount )\n        {                 \n            \n            float iter = float(r) \/ float(rayCount);\n            float ao = (1.-iter);\n            ao*=ao;\n            ao = 1.-ao;\n                        \n            float mask = max(0.,(1.-length(p\/2.)));            \n            mask *= abs(sin(iTime*-1.5+length(p)+p.x)-.2);            \n            color += 2.*vec3(.1,1.,.8) * max(0.,(noise(p)*4.-2.6)) * mask;            \n            color += vec3(.1,.5,.6) * ao * 6.;            \n            color += vec3(.27,.2,.4)*(t\/8.);\n                       \n            color *= 2.;\n            color -= .15;\n                        \n            break;          \n        }\n        \n        \/\/ march along ray\n        t +=  d *.5;        \n    }\n    \n    \/\/ vignetting effect by Ippokratis\n    \/\/ https:\/\/www.shadertoy.com\/view\/lsKSWR\n    uv = fragCoord.xy \/ iResolution.xy;\n    uv *=  1.0 - uv.yx; \n    float vig = uv.x*uv.y * 20.0;    \n    vig = pow(vig, 0.25);        \n    color *= vig;\n    \n    \/\/color adjustement\n    color.y *= .8;\n    color.x *= 1.5;\n    \n\tfragColor = vec4(color, 1);\n}","name":"Image","description":"","type":"image"}]}];
    var gUseScreenshots = piIsMobile();
    var gThemeName = "classic";
    </script>    
</head>

<body onload="resultsInitStatic(5,null,null)">


<div id="header">

    <div id="headerBlock1">
        <a href="/" id="headerTitle">Shadertoy</a>
        <form name="formSearch" action="/results" method="get" style="display:inline-block;">
        <div  id="headerSearch">
            <input type="search" id="mySearch" name="query" placeholder="Search..." value=""/>
        </div>
        </form>
    </div>

    <div id="headerBlock2">
                <span style="padding-top:14px;padding-bottom:14px;">

            Welcome            <a class="headerLinks" style="padding-right:3px;" href="/profile/?show=shaders">teaqu</a>
                            <sup class="notificationCount">
                <a href="/profile/?show=notifications" style="text-decoration:none;">
                2                </sup>
                </a>
                <div style="display:inline-block;width:2px;"></div> 
                            |
            <a class="headerLinks" href="/browse">Browse</a>
            <a class="headerLinks" href="/new">New</a>
            <a class="headerLinks" href="/signout">Logout</a>
            </span>
        </div>
</div>

<div id="content">

    <div id="blockTop">

        <div id="block0">
            <div class="normalText"><a class="regular" href="https://www.shadertoy.com/playlist/week">Shader of the Week</a></div>
            <div class="shaderBig"><div class='shaderPreviewContainer' id='Preview_0_Container'>  <a class='shaderPreview shaderPreviewContent' id='Preview_0_Link'>    <div class='previewNoGLContainter shaderPreviewContent' id='Preview_0_NoWebGL'>        <img class='previewThumbnailImage' id='Preview_0_ThumnailImageNoWebGL'></img>        <div class='previewNoGLMessage' id='Preview_0_MessageNoWebGL'>No Screenshot Availabe</div>    </div>    <div class='previewErrorContainer shaderPreviewContent' id='Preview_0_Error'>        <div class='previewErrorMessage'>Shader Error</div>    </div>    <div class='previewThumbnailContainer shaderPreviewContent' id='Preview_0_Thumnail'>        <img class='previewThumbnailImage' id='Preview_0_ThumnailImage'></img>        <div class='previewThumbnailIcon' id='Preview_0_ThumnailWarning1' title='This shader takes too long to compile, a preview image is shown instead to improve browsing.
Click on the shader to see it in real-time.'>Warning</div>        <div class='previewThumbnailIcon' id='Preview_0_ThumnailWarning2' title='You are using static shader previews.
Click on the shader to see it in real-time.'>Preview</div>    </div>    <canvas class='previewCanvas shaderPreviewContent' id='Preview_0_Canvas'></canvas>  </a></div><div class='previewInfo' id='Preview_0_Info'>  <span class='previewText'  id='Preview_0_Text'></span>  <span>by</span>  <span class='previewTextUser'  id='Preview_0_TextUser'></span>  <span class='previewStats' id='Preview_0_Stats'></span></div></div>
        </div>

        <div id="block1">
            <div class="bigText"><span class="boldText">Build</span> <span class="grayText">and </span><span class="boldText">Share</span> <span class="grayText">your best shaders with the world and get</span> <span class="boldText">Inspired</span></div>
            <div id="donations" style="display:flex;">
                <div id="donate-button-container" style="padding-right:32px;">
                    <div id="donate-button"></div>
                    <script src="https://www.paypalobjects.com/donate/sdk/donate-sdk.js" charset="UTF-8"></script>
                    <script>
                        PayPal.Donation.Button({
                            env:'production',
                            hosted_button_id:'8H3QTL2VPKSLL',
                            image: {
                            src:'/img/paypal.png',
                            alt:'Donate with PayPal button',
                            title:'PayPal - The safer, easier way to pay online!',
                        }
                        }).render('#donate-button');
                    </script>
                </div>
                <a href="https://www.patreon.com/bePatron?u=6602149"><img src="/img/patreon.png"/></a>
            </div>
            <div class="contributors">
                <span class="contributorsHead"><a href="/results?sort=newest" class="regular">Latest contributions: </a></span><span><a class='regular' href='/view/tXGfWD'>"sssss2027"</a> by <a class='regular' href='/user/DJDIABLILLO'>DJDIABLILLO</a> 34 minutes ago, </span><span><a class='regular' href='/view/w3yBzm'>"Forgetting Path"</a> by <a class='regular' href='/user/Frostbyte_'>Frostbyte_</a> 1 hour ago, </span><span><a class='regular' href='/view/tXGfDW'>"Microbes"</a> by <a class='regular' href='/user/NullSoftware'>NullSoftware</a> 1 hour ago, </span><span><a class='regular' href='/view/3XyfDD'>"Tarantella Napoletana"</a> by <a class='regular' href='/user/PeaProtein'>PeaProtein</a> 2 hours ago, </span><span><a class='regular' href='/view/tXyBWW'>"Caustic Study #03: Crystal"</a> by <a class='regular' href='/user/guinetik'>guinetik</a> 3 hours ago</span>            </div>
        </div>
    </div>
    
  <div id="blockBottom">
      <div class="normalText"><a class="regular" href="https://www.shadertoy.com/playlist/featured">Featured Shaders</a></div>
      <div id="blockPreviews">
        <div class="shaderSmall"><div class='shaderPreviewContainer' id='Preview_1_Container'>  <a class='shaderPreview shaderPreviewContent' id='Preview_1_Link'>    <div class='previewNoGLContainter shaderPreviewContent' id='Preview_1_NoWebGL'>        <img class='previewThumbnailImage' id='Preview_1_ThumnailImageNoWebGL'></img>        <div class='previewNoGLMessage' id='Preview_1_MessageNoWebGL'>No Screenshot Availabe</div>    </div>    <div class='previewErrorContainer shaderPreviewContent' id='Preview_1_Error'>        <div class='previewErrorMessage'>Shader Error</div>    </div>    <div class='previewThumbnailContainer shaderPreviewContent' id='Preview_1_Thumnail'>        <img class='previewThumbnailImage' id='Preview_1_ThumnailImage'></img>        <div class='previewThumbnailIcon' id='Preview_1_ThumnailWarning1' title='This shader takes too long to compile, a preview image is shown instead to improve browsing.
Click on the shader to see it in real-time.'>Warning</div>        <div class='previewThumbnailIcon' id='Preview_1_ThumnailWarning2' title='You are using static shader previews.
Click on the shader to see it in real-time.'>Preview</div>    </div>    <canvas class='previewCanvas shaderPreviewContent' id='Preview_1_Canvas'></canvas>  </a></div><div class='previewInfo' id='Preview_1_Info'>  <span class='previewText'  id='Preview_1_Text'></span>  <span>by</span>  <span class='previewTextUser'  id='Preview_1_TextUser'></span>  <span class='previewStats' id='Preview_1_Stats'></span></div></div>
        <div class="shaderSmall"><div class='shaderPreviewContainer' id='Preview_2_Container'>  <a class='shaderPreview shaderPreviewContent' id='Preview_2_Link'>    <div class='previewNoGLContainter shaderPreviewContent' id='Preview_2_NoWebGL'>        <img class='previewThumbnailImage' id='Preview_2_ThumnailImageNoWebGL'></img>        <div class='previewNoGLMessage' id='Preview_2_MessageNoWebGL'>No Screenshot Availabe</div>    </div>    <div class='previewErrorContainer shaderPreviewContent' id='Preview_2_Error'>        <div class='previewErrorMessage'>Shader Error</div>    </div>    <div class='previewThumbnailContainer shaderPreviewContent' id='Preview_2_Thumnail'>        <img class='previewThumbnailImage' id='Preview_2_ThumnailImage'></img>        <div class='previewThumbnailIcon' id='Preview_2_ThumnailWarning1' title='This shader takes too long to compile, a preview image is shown instead to improve browsing.
Click on the shader to see it in real-time.'>Warning</div>        <div class='previewThumbnailIcon' id='Preview_2_ThumnailWarning2' title='You are using static shader previews.
Click on the shader to see it in real-time.'>Preview</div>    </div>    <canvas class='previewCanvas shaderPreviewContent' id='Preview_2_Canvas'></canvas>  </a></div><div class='previewInfo' id='Preview_2_Info'>  <span class='previewText'  id='Preview_2_Text'></span>  <span>by</span>  <span class='previewTextUser'  id='Preview_2_TextUser'></span>  <span class='previewStats' id='Preview_2_Stats'></span></div></div>
        <div class="shaderSmall"><div class='shaderPreviewContainer' id='Preview_3_Container'>  <a class='shaderPreview shaderPreviewContent' id='Preview_3_Link'>    <div class='previewNoGLContainter shaderPreviewContent' id='Preview_3_NoWebGL'>        <img class='previewThumbnailImage' id='Preview_3_ThumnailImageNoWebGL'></img>        <div class='previewNoGLMessage' id='Preview_3_MessageNoWebGL'>No Screenshot Availabe</div>    </div>    <div class='previewErrorContainer shaderPreviewContent' id='Preview_3_Error'>        <div class='previewErrorMessage'>Shader Error</div>    </div>    <div class='previewThumbnailContainer shaderPreviewContent' id='Preview_3_Thumnail'>        <img class='previewThumbnailImage' id='Preview_3_ThumnailImage'></img>        <div class='previewThumbnailIcon' id='Preview_3_ThumnailWarning1' title='This shader takes too long to compile, a preview image is shown instead to improve browsing.
Click on the shader to see it in real-time.'>Warning</div>        <div class='previewThumbnailIcon' id='Preview_3_ThumnailWarning2' title='You are using static shader previews.
Click on the shader to see it in real-time.'>Preview</div>    </div>    <canvas class='previewCanvas shaderPreviewContent' id='Preview_3_Canvas'></canvas>  </a></div><div class='previewInfo' id='Preview_3_Info'>  <span class='previewText'  id='Preview_3_Text'></span>  <span>by</span>  <span class='previewTextUser'  id='Preview_3_TextUser'></span>  <span class='previewStats' id='Preview_3_Stats'></span></div></div>
        <div class="shaderSmall"><div class='shaderPreviewContainer' id='Preview_4_Container'>  <a class='shaderPreview shaderPreviewContent' id='Preview_4_Link'>    <div class='previewNoGLContainter shaderPreviewContent' id='Preview_4_NoWebGL'>        <img class='previewThumbnailImage' id='Preview_4_ThumnailImageNoWebGL'></img>        <div class='previewNoGLMessage' id='Preview_4_MessageNoWebGL'>No Screenshot Availabe</div>    </div>    <div class='previewErrorContainer shaderPreviewContent' id='Preview_4_Error'>        <div class='previewErrorMessage'>Shader Error</div>    </div>    <div class='previewThumbnailContainer shaderPreviewContent' id='Preview_4_Thumnail'>        <img class='previewThumbnailImage' id='Preview_4_ThumnailImage'></img>        <div class='previewThumbnailIcon' id='Preview_4_ThumnailWarning1' title='This shader takes too long to compile, a preview image is shown instead to improve browsing.
Click on the shader to see it in real-time.'>Warning</div>        <div class='previewThumbnailIcon' id='Preview_4_ThumnailWarning2' title='You are using static shader previews.
Click on the shader to see it in real-time.'>Preview</div>    </div>    <canvas class='previewCanvas shaderPreviewContent' id='Preview_4_Canvas'></canvas>  </a></div><div class='previewInfo' id='Preview_4_Info'>  <span class='previewText'  id='Preview_4_Text'></span>  <span>by</span>  <span class='previewTextUser'  id='Preview_4_TextUser'></span>  <span class='previewStats' id='Preview_4_Stats'></span></div></div>
      </div>
  </div>

</div>

<!-- footer ------------------------ -->

<div id="footer">
    
    <div><span style="color:#ffffff;">Community Forums</span>
      <ul>
      <li><a class="regular" href="/events">Official Events</a></li>
      <li><a class="regular" href="https://www.facebook.com/groups/147749602472741">In Facebook (english)</a></li>
      <li><a class="regular" href="https://www.facebook.com/groups/1339783682699494">In Facebook (korean)</a></li>
      <li><a class="regular" href="https://discord.gg/XtmMN6E">In Discord</a> (<a class="regular" href="https://discordapp.com/channels/578696555612209173/579531723348639754">direct link</a>)</li>
      </ul>
    </div>

    <div><span style="color:#ffffff;">Feedback and Support</span>
      <ul>
      <li><a class="regular" href="https://www.facebook.com/Shadertoy">Facebook</a></li>
      <li><a class="regular" href="https://twitter.com/shadertoy">Twitter</a></li>
      <li><a class="regular" href="https://www.patreon.com/shadertoy">Patreon</a></li>
      <li><a class="regular" href="https://trello.com/b/5hM0CjId">Roadmap</a></li>

            <li><a class="regular" href="mailto:info@shadertoy.com?Subject=Hello%20Shadertoy">Email</a></li>
      
      </ul>
    </div>

    <div><span style="color:#ffffff;">Shadertoy</span>
      <ul>
      <li><a class="regular" href="/store">Store</a></li>
      <li><a class="regular" href="/howto">Documentation</a></li>
      <li><a class="regular" href="/terms">Terms & Privacy</a></li>
      <li><a class="regular" href="/about">About</a></li>
      </ul>
    </div>

    <div><span style="color:#ffffff;">Apps and Plugins</span>
      <ul>
      <li><a class="regular" href="https://itunes.apple.com/us/app/shadertoy/id717961814">Official iPhone App</a> by <a class="user" href="/user/reinder">Reinder</a></li>
      <li><a class="regular" href="https://steamcommunity.com/sharedfiles/filedetails/?id=1726697188">Screensaver</a> by <a class="user" href="/user/kosro">Kosro</a></li>
      <li><a class="regular" href="https://chrome.google.com/webstore/detail/shadertoy-unofficial-plug/ohicbclhdmkhoabobgppffepcopomhgl">Shadertoy plugin</a> by <a class="user" href="/user/patu">Patu</a></li>
      </ul>
    </div>

    <div><span style="color:#ffffff;">Tutorials</span>
      <ul>
      <li><a class="regular" href="https://www.youtube.com/watch?v=0ifChJ0nJfM">Shader coding intro</a> by <a class="user" href="/user/iq">iq</a></li>
      <li><a class="regular" href="https://shadertoyunofficial.wordpress.com/">Shadertoy Unofficial</a> by <a class="user" href="/user/FabriceNeyret2">FabriceNeyret2</a></li>
      </ul>
    </div>

</div>

<div id="compliance" style="padding-bottom:6px;visibility:hidden;left:0;top:0px;width:100%;background-color:rgb(200,120,20,0.93);position:absolute;color:#FFFFFF">
    <div style="text-align: center; margin-top:8px">
        We use cookies to give you the best experience on our website. If you continue using Shadertoy, we'll assume that you are happy to receive all cookies on this website. 
        For more information, please review our <a class="regular" href="/terms">Terms & Privacy</a>.
    </div> 
    <div style="text-align: center;margin-top:6px">
        <button type="button" style="width:100px;font-size:inherit" onclick="acceptCompliance()">Accept</button>
    </div>
</div>

<script>
(function runCompliance() 
{
    let showCompliance = 1;
    let allcookies = document.cookie;
    let cookiearray = allcookies.split(';');
    for (var i=0; i<cookiearray.length; i++)
    {
        let name  = cookiearray[i].split('=')[0];
        let value = cookiearray[i].split('=')[1];
        if (name.trim() == "scmp") 
        {
            showCompliance = value;
            break;
        }
    }

    if (showCompliance === 1) 
    {
        var ve = document.getElementById("compliance");
        ve.style.visibility="visible";
    }
})();

function acceptCompliance()
{
    let now = new Date();
    now.setTime( now.getTime() + (5*365*24*60*60*1000) );
    document.cookie="scmp=0;expires=" + now.toUTCString() + ";";

    var ve = document.getElementById("compliance");
    ve.style.visibility="hidden";
}
</script>


</body>

</html>
