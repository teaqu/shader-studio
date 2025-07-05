//==============================================================================
//
// piWebVR
//
//==============================================================================

function WebVR( isVREnabledCallback, canvasElement )
{
    this.mSupportVR = false;
    this.mHMD = null;
    this.mHMDSensor = null;
    //this.mRenderingStereo = false;

    var me = this;
    var listVRDevices = function( vrdevs )
                        {
                            for( var i=0; i<vrdevs.length; i++ )
                            {
                                if( vrdevs[i] instanceof HMDVRDevice )
                                {
                                    me.mHMD = vrdevs[i];
                                    //console.log( me.mHMD );
                                    break;
                                }
                            }

                            for( var i=0; i<vrdevs.length; i++ )
                            {
                                if( vrdevs[i] instanceof PositionSensorVRDevice && vrdevs[i].hardwareUnitId == me.mHMD.hardwareUnitId)
                                {
                                    me.mHMDSensor = vrdevs[i];
                                    //console.log( me.mHMDSensor );
                                    break;
                                }
                            }
                            isVREnabledCallback( true );
                            me.mSupportVR = true;
                        }

         if( navigator.getVRDevices )    navigator.getVRDevices().then( listVRDevices ); 
    else if( navigator.mozGetVRDevices ) navigator.mozGetVRDevices( listVRDevices );
    else     console.log( "No WebVR!" );

    isVREnabledCallback( false );

    this.mCanvas = canvasElement;
    //var vres = [ 2*1182, 1464 ];
    //this.mCanvas.width  = vres[0];
    //this.mCanvas.height = vres[1];
    //this.mCanvas.style.width = vres[0] + "px";
    //this.mCanvas.style.height = vres[1] + "px";


//    console.log( "Suported: " + this.mSupportVR );
}

WebVR.prototype.IsSupported = function()
{
    return this.mSupportVR;
}

WebVR.prototype.GetData = function( id )
{
    var ss   = this.mHMDSensor.getState();
    var fovL = this.mHMD.getEyeParameters( "left" );
    var fovR = this.mHMD.getEyeParameters( "right" );

    // camera info
    var cPos = vec3(0.0,0.0,0.0);
    if( ss.position ) 
        cPos = vec3(-ss.position.x, -ss.position.y, -ss.position.z);
    var cRot = setFromQuaternion( vec4(ss.orientation.x, ss.orientation.y, ss.orientation.z, ss.orientation.w) );
    var cTra = setTranslation( cPos );
    var cMat = matMul( invertFast(cRot), cTra);

    // per eye info
    //var lTra = setTranslation( add(cPos, vec3(-fovL.eyeTranslation.x, -fovL.eyeTranslation.y, -fovL.eyeTranslation.z)) );
    var lTra = setTranslation( vec3(-fovL.eyeTranslation.x, -fovL.eyeTranslation.y, -fovL.eyeTranslation.z) );
    var lMat = matMul( lTra, cMat );
    var lPrj = [ Math.tan( fovL.recommendedFieldOfView.upDegrees * Math.PI/180.0),
                 Math.tan( fovL.recommendedFieldOfView.downDegrees * Math.PI/180.0),
                 Math.tan( fovL.recommendedFieldOfView.leftDegrees * Math.PI/180.0),
                 Math.tan( fovL.recommendedFieldOfView.rightDegrees * Math.PI/180.0) ];

    //var rTra = setTranslation( add(cPos, vec3(-fovR.eyeTranslation.x, -fovR.eyeTranslation.y, -fovR.eyeTranslation.z)) );
    var rTra = setTranslation( vec3(-fovR.eyeTranslation.x, -fovR.eyeTranslation.y, -fovR.eyeTranslation.z) );
    var rMat = matMul( rTra, cMat );
    var rPrj = [ Math.tan( fovR.recommendedFieldOfView.upDegrees * Math.PI/180.0),
                 Math.tan( fovR.recommendedFieldOfView.downDegrees * Math.PI/180.0),
                 Math.tan( fovR.recommendedFieldOfView.leftDegrees * Math.PI/180.0),
                 Math.tan( fovR.recommendedFieldOfView.rightDegrees * Math.PI/180.0) ];

    return { mCamera   : { mCamera:cMat },
             mLeftEye  : { mVP:[fovL.renderRect.x,fovL.renderRect.y,fovL.renderRect.width,fovL.renderRect.height], mProjection:lPrj, mCamera:lMat },
             mRightEye : { mVP:[fovR.renderRect.x,fovR.renderRect.y,fovR.renderRect.width,fovR.renderRect.height], mProjection:rPrj, mCamera:rMat } };
}

WebVR.prototype.Enable = function( id )
{
         if( this.mCanvas.mozRequestFullScreen )    { this.mCanvas.mozRequestFullScreen(    { vrDisplay: this.mHMD } ); }
    else if( this.mCanvas.webkitRequestFullscreen ) { this.mCanvas.webkitRequestFullscreen( { vrDisplay: this.mHMD } ); }
    else console.log( "Couldn't switch to fullscreen VR" );
}

WebVR.prototype.Disable = function( id )
{
}