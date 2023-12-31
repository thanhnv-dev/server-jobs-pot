const UserModel = require('../models/user.model.js');
const Firebase = require('../middleware/Firebase.js');
const JWToken = require('../middleware/JWToken.js');
const {createTransport} = require('nodemailer');
const emailjs = require('@emailjs/nodejs');
const {
  generateRandomCode,
  hasPassed2Minutes,
  getFileName,
  getCurrentTimeUTC,
  getMsg,
} = require('../utils/index.js');
const {
  BREVO_PASS,
  BREVO_USER,
  MAILJS_SERVICE_ID_1,
  MAILJS_TEMPLATE_ID_1,
  MAILJS_PUBLIC_KEY_1,
  MAILJS_PRIVATE_KEY_1,
  MAILJS_PUBLIC_KEY_2,
  MAILJS_PRIVATE_KEY_2,
  MAILJS_SERVICE_ID_2,
  MAILJS_TEMPLATE_ID_2,
  MSG_TYPE,
  STATUS_CODE,
} = require('../constants/index.js');
const VerificationCodeModel = require('../models/verificationCode.model.js');
const admin = require('firebase-admin');

const sendByBrevoService = async (verificationCode, email) => {
  const transporter = createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    auth: {
      user: BREVO_USER,
      pass: BREVO_PASS,
    },
  });

  const mailOptions = {
    from: BREVO_USER,
    to: email,
    subject: `${verificationCode} is your verification code`,
    html: `<div> <h1>Verify Your Account</h1><p>Hello,</p> <p>Here is your verification code:</p><p><strong>Verification Code:</strong> ${verificationCode}</p><p>Please use this code to complete the account verification process. Please note that this code is only valid for a short period of time.</p><p>Thank you for joining us!</p><p>Best regards</p></div>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    return {
      status: true,
      msg: getMsg(MSG_TYPE.successfully, 'Send by Brevo Service'),
    };
  } catch (error) {
    return {
      status: false,
      msg: getMsg(MSG_TYPE.failed, 'Send by Brevo Service'),
    };
  }
};

const sendByEmailJSService = async (
  count,
  publicKey,
  privateKey,
  serviceId,
  templateId,
  verificationCode,
  email,
) => {
  emailjs.init({
    publicKey: publicKey,
    privateKey: privateKey,
  });

  const templateParams = {
    verificationCode: verificationCode,
    to: email,
  };

  try {
    await emailjs.send(serviceId, templateId, templateParams);

    return {
      status: true,
      msg: getMsg(MSG_TYPE.successfully, 'Send by EmailJS Service ${count}'),
    };
  } catch (error) {
    return {
      status: false,
      msg: getMsg(MSG_TYPE.failed, 'Send by EmailJS Service ${count}'),
    };
  }
};

const sendEmail = async (verificationCode, email) => {
  const sendByEmailJSService_1 = await sendByEmailJSService(
    1,
    MAILJS_PUBLIC_KEY_1,
    MAILJS_PRIVATE_KEY_1,
    MAILJS_SERVICE_ID_1,
    MAILJS_TEMPLATE_ID_1,
    verificationCode,
    email,
  );

  if (sendByEmailJSService_1.status) {
    return {status: true, msg: sendByEmailJSService_1.msg};
  } else {
    const sendByEmailJSService_2 = await sendByEmailJSService(
      2,
      MAILJS_PUBLIC_KEY_2,
      MAILJS_PRIVATE_KEY_2,
      MAILJS_SERVICE_ID_2,
      MAILJS_TEMPLATE_ID_2,
      verificationCode,
      email,
    );

    if (sendByEmailJSService_2.status) {
      return {status: true, msg: sendByEmailJSService_2.msg};
    } else {
      sendByBrevoService(verificationCode, email);
    }
  }
};

const checkDataAndUpdateVerificationCode = async (email, verificationCode) => {
  const findMail = await VerificationCodeModel.findOne({email});

  if (findMail) {
    const updateVerificationCodeResult = await VerificationCodeModel.updateOne(
      {email},
      {code: verificationCode},
    );
    return !!updateVerificationCodeResult.acknowledged;
  } else {
    const newVerificationCodeData = new VerificationCodeModel({
      email,
      code: verificationCode,
    });
    const newData = await newVerificationCodeData.save();
    return !!newData;
  }
};

const sendVerificationCode = async email => {
  const findUserByEmail = await UserModel.findOne({
    email: email?.toLowerCase(),
  });
  if (findUserByEmail) {
    // if (findUserByEmail.email_verified) {
    //   return {status: STATUS_CODE.error, res: {msg: 'This email has been verified!'}};
    // } else {
    const verificationCode = generateRandomCode();

    const checkDataResutl = await checkDataAndUpdateVerificationCode(
      email,
      verificationCode,
    );

    if (checkDataResutl) {
      const sendResult = await sendEmail(verificationCode, email);

      if (sendResult?.status) {
        return {
          status: STATUS_CODE.success,
          res: {msg: getMsg(MSG_TYPE.successfully, 'Email sent')},
          msg: sendResult.msg,
        };
      }
    }
    return {status: STATUS_CODE.error, res: {msg: getMsg(MSG_TYPE.wrong)}};
    // }
  } else {
    return {
      status: STATUS_CODE.error,
      res: {msg: 'This email is not yet associated with a user.'},
    };
  }
};

const verifyCodeService = async code => {
  const findCodeResult = await VerificationCodeModel.findOne({code});

  if (findCodeResult) {
    const email = findCodeResult?.email;
    const lastUpdatedTime = findCodeResult.updatedAt;
    const codeDataBase = findCodeResult.code;
    const hasPassed = hasPassed2Minutes(lastUpdatedTime);
    if (!hasPassed && code == codeDataBase) {
      const findUserByEmail = await UserModel.findOne({
        email: email?.toLowerCase(),
      });

      if (findUserByEmail) {
        const userData = findUserByEmail.toObject();
        if (!userData.email_verified) {
          const updateUserResult = await UserModel.updateOne(
            {email},
            {email_verified: true},
          );

          if (!updateUserResult.acknowledged) {
            return {
              status: STATUS_CODE.error,
              res: {msg: getMsg(MSG_TYPE.wrong)},
            };
          } else {
            Firebase.updateVerifyEmailUser(findUserByEmail.uid);
          }
        }
      }
      return {
        status: STATUS_CODE.success,
        res: {msg: 'Verified successfully!'},
      };
    }
  }
  return {
    status: STATUS_CODE.error,
    res: {msg: 'The verification code is incorrect or has expired!'},
  };
};

const findUserByEmail = async email => {
  const result = await UserModel.findOne({
    email: email?.toLowerCase(),
  });

  return result;
};

const findUserByUid = async uid => {
  const result = await UserModel.findOne({
    uid: uid,
  });

  return result;
};

const findUserById = async id => {
  try {
    const result = await UserModel.findById(id);
    return result;
  } catch (error) {
    return null;
  }
};

const findUser = async (email, password) => {
  const result = await UserModel.findOne({
    email: email?.toLowerCase(),
    password: password,
  });

  return result;
};

const profile = async req => {
  const {id} = req.query;

  const userDataBase = await findUserById(id);

  if (userDataBase) {
    const resUserData = userDataBase.toObject();

    const {token, refresh_token} = JWToken.createTokens({
      uid: resUserData.uid,
    });

    delete resUserData.createdAt;
    delete resUserData.updatedAt;

    const res = {
      results: resUserData,
      token,
      refresh_token,
      msg: 'Get profile Successfully!',
    };
    return {status: STATUS_CODE.success, res};
  } else {
    return {
      status: STATUS_CODE.error,
      res: {msg: getMsg(MSG_TYPE.account_error)},
    };
  }
};

const createUserFormFirebaseData = async (userData, userName) => {
  const newUser = new UserModel({
    email: userData.email,
    user_name: userData.displayName ?? userName,
    uid: userData.uid,
    email_verified: userData?.providerData[0].providerId.includes('facebook')
      ? true
      : userData.emailVerified,
    provider_data: userData.providerData,
    photo_url: userData?.providerData[0].providerId.includes('google')
      ? userData.photoURL
      : null,
  });
  return await newUser.save();
};

const checkDataUserAndUpdate = async (userDataFirebase, currentUserData) => {
  if (currentUserData.provider_data !== userDataFirebase.providerData) {
    await UserModel.updateOne(
      {uid: userDataFirebase.uid},
      {
        provider_data: userDataFirebase.providerData,
      },
    );
  }
  if (!currentUserData.email_verified && userDataFirebase.emailVerified) {
    await UserModel.updateOne(
      {uid: userDataFirebase.uid},
      {
        email_verified: userDataFirebase.emailVerified,
      },
    );
  }
};

const checkPhotoUser = async (userDataFirebase, currentUserData) => {
  if (!currentUserData.photo_url) {
    await userDataFirebase?.providerData?.forEach(async e => {
      if (e?.providerId?.includes('google')) {
        await UserModel.updateOne(
          {uid: userDataFirebase.uid},
          {
            photo_url: e.photoURL,
          },
        );
      }
    });
  }
};

const signInWithFirebase = async token_firebase => {
  const userDataFirebase = await Firebase.getUserFromToken(token_firebase);

  if (userDataFirebase) {
    const currentUserData = await findUserByUid(userDataFirebase.uid);
    if (currentUserData) {
      await checkDataUserAndUpdate(userDataFirebase, currentUserData);
      await checkPhotoUser(userDataFirebase, currentUserData);

      const userData = await findUserByUid(userDataFirebase.uid);

      const {token, refresh_token} = JWToken.createTokens({
        uid: userDataFirebase.uid,
      });

      const resUserData = userData.toObject();
      delete resUserData.createdAt;
      delete resUserData.updatedAt;

      const res = {
        results: resUserData,
        token,
        refresh_token,
        msg: 'Login Successfully!',
      };

      return {status: STATUS_CODE.success, res};
    } else {
      const createUser = await createUserFormFirebaseData(userDataFirebase);

      if (createUser) {
        const {token, refresh_token} = JWToken.createTokens({
          uid: createUser.uid,
        });
        const resUserData = createUser.toObject();
        delete resUserData.createdAt;
        delete resUserData.updatedAt;

        const res = {
          results: resUserData,
          token,
          refresh_token,
          msg: 'Login Successfully!',
        };

        return {status: STATUS_CODE.success, res};
      } else {
        return {
          status: STATUS_CODE.error,
          res: {msg: getMsg(MSG_TYPE.wrong)},
        };
      }
    }
  } else {
    return {
      status: STATUS_CODE.error,
      res: {msg: 'Incorrect account information!'},
    };
  }
};

const signUpWithEmail = async (user_name, token_firebase) => {
  const userDataFirebase = await Firebase.getUserFromToken(token_firebase);

  if (userDataFirebase) {
    const email = userDataFirebase.email;

    const findUserByEmailResult = await findUserByEmail(email);
    if (findUserByEmailResult) {
      return {
        status: STATUS_CODE.error,
        res: {msg: 'Email registered!'},
      };
    } else {
      const createUser = await createUserFormFirebaseData(
        userDataFirebase,
        user_name,
      );

      if (createUser) {
        const resUserData = createUser.toObject();
        const {token, refresh_token} = JWToken.createTokens({
          uid: resUserData.uid,
        });
        delete resUserData.createdAt;
        delete resUserData.updatedAt;
        const res = {
          results: resUserData,
          token,
          refresh_token,
          msg: 'SignUp Successfully!',
        };
        return {status: STATUS_CODE.success, res};
      } else {
        return {
          status: STATUS_CODE.error,
          res: {msg: getMsg(MSG_TYPE.error_re_login)},
        };
      }
    }
  } else {
    return {
      status: STATUS_CODE.error,
      res: {msg: getMsg(MSG_TYPE.error_re_login)},
    };
  }
};

const updateImage = async req => {
  const {id} = req.body;
  const imageFile = req.files[0];
  const fileName = imageFile.originalname;
  const isAvatar = fileName.includes('avatar');

  const userData = await findUserById(id);

  if (!userData) {
    return {
      status: STATUS_CODE.error,
      res: {msg: getMsg(MSG_TYPE.account_error)},
    };
  }

  if (!imageFile) {
    return {
      status: STATUS_CODE.error,
      res: {msg: 'No files found!'},
    };
  }

  const bucket = admin.storage().bucket();

  if (userData.photo_url && userData.background_url) {
    const filePathOld = `user_images/${id}/${getFileName(
      isAvatar ? userData.photo_url : userData.background_url,
    )}`;

    await bucket
      .file(filePathOld)
      .delete()
      .catch(_ => {
        console.error('Error deleting old file');
      });
  }

  const currentDate = getCurrentTimeUTC();
  const filePath = `user_images/${id}/${currentDate}_${fileName}`;

  const blob = bucket.file(filePath);

  const blobWriter = blob.createWriteStream({
    metadata: {
      contentType: imageFile.mimetype,
    },
  });

  const finishPromise = new Promise((resolve, reject) => {
    blobWriter.on('error', _ => {
      reject(new Error(getMsg(MSG_TYPE.wrong)));
    });

    blobWriter.on('finish', async () => {
      resolve();
    });
  });

  blobWriter.end(imageFile.buffer);

  try {
    await finishPromise;

    const downloadUrl = await blob.getSignedUrl({
      action: 'read',
      expires: '01-01-2100',
    });

    const updateAvatarRes = await UserModel.updateOne(
      {
        _id: id,
      },
      isAvatar ? {photo_url: downloadUrl[0]} : {background_url: downloadUrl[0]},
    );

    if (updateAvatarRes.acknowledged) {
      const userDataNew = await findUserById(id);

      if (userDataNew) {
        const resDataUser = userDataNew.toObject();
        delete resDataUser.createdAt;
        delete resDataUser.updatedAt;

        return {
          status: STATUS_CODE.success,
          res: {
            results: resDataUser,
            msg: isAvatar
              ? 'Update avatar successfully!'
              : 'Update background successfully!',
          },
        };
      }
    }

    return {
      status: STATUS_CODE.error,
      res: {msg: getMsg(MSG_TYPE.wrong)},
    };
  } catch (error) {
    return {
      status: STATUS_CODE.error,
      res: {msg: getMsg(MSG_TYPE.wrong)},
    };
  }
};

const refreshToken = async req => {
  const {refresh_token} = req.body;

  const verifyRefreshTokenResult = JWToken.verifyRefreshToken(refresh_token);

  if (verifyRefreshTokenResult) {
    const {token, refresh_token} = JWToken.createTokens({
      data: refresh_token,
    });

    const res = {
      token,
      refresh_token,
      msg: 'Refresh token Successfully!',
    };
    return {status: STATUS_CODE.success, res};
  } else {
    return {
      status: 403,
      res: {msg: 'Forbidden'},
    };
  }
};

const updateInformations = async req => {
  const {userName, dateOfBirth, gender, id, phoneNumber, location} = req.body;
  const userData = await findUserById(id);

  if (userData) {
    if (userName) {
      await UserModel.updateOne({_id: id}, {user_name: userName});
    }

    if (dateOfBirth) {
      await UserModel.updateOne({_id: id}, {date_of_birth: dateOfBirth});
    }
    if (gender) {
      await UserModel.updateOne({_id: id}, {gender});
    }

    if (phoneNumber) {
      await UserModel.updateOne({_id: id}, {phone_number: phoneNumber});
    }

    if (location) {
      await UserModel.updateOne({_id: id}, {location});
    }

    const userDataBase = await findUserById(id);

    if (userDataBase) {
      const resUserData = userDataBase.toObject();

      delete resUserData.createdAt;
      delete resUserData.updatedAt;
      const res = {
        results: resUserData,
        msg: 'Update information successfully!',
      };
      return {status: STATUS_CODE.success, res};
    } else {
      return {
        status: STATUS_CODE.error,
        res: {msg: getMsg(MSG_TYPE.account_error)},
      };
    }
  } else {
    return {
      status: STATUS_CODE.error,
      res: {msg: getMsg(MSG_TYPE.error_re_login)},
    };
  }
};

const accountLink = async req => {
  const {provider_data, id} = req.body;

  const userData = await findUserById(id);

  if (!userData) {
    return {
      status: STATUS_CODE.error,
      res: {msg: getMsg(MSG_TYPE.account_error)},
    };
  }
  const userDataObject = userData.toObject();

  const providerDataNew = [...userDataObject.provider_data];

  providerDataNew.push(provider_data);

  const updateProviderData = await UserModel.updateOne(
    {_id: id},
    {provider_data: providerDataNew},
  );

  if (updateProviderData.acknowledged) {
    const userDataNew = await findUserById(id);

    if (userDataNew) {
      const resDataUser = userDataNew.toObject();
      delete resDataUser.createdAt;
      delete resDataUser.updatedAt;

      return {
        status: STATUS_CODE.success,
        res: {
          results: resDataUser,
          msg: 'Account link successfully!',
        },
      };
    }
  }
  return {
    status: STATUS_CODE.error,
    res: {msg: getMsg(MSG_TYPE.wrong)},
  };
};

const accountUnLink = async req => {
  const {provider_id, id} = req.body;

  const userData = await findUserById(id);

  if (!userData) {
    return {
      status: STATUS_CODE.error,
      res: {msg: getMsg(MSG_TYPE.account_error)},
    };
  }
  const userDataObject = userData.toObject();

  const providerDataNew = userDataObject.provider_data.filter(
    e => e.providerId != provider_id,
  );

  const updateProviderData = await UserModel.updateOne(
    {_id: id},
    {provider_data: providerDataNew},
  );

  if (updateProviderData.acknowledged) {
    const userDataNew = await findUserById(id);

    if (userDataNew) {
      const resDataUser = userDataNew.toObject();
      delete resDataUser.createdAt;
      delete resDataUser.updatedAt;

      return {
        status: STATUS_CODE.success,
        res: {
          results: resDataUser,
          msg: 'Account unlink successfully!',
        },
      };
    }
  }
  return {
    status: STATUS_CODE.error,
    res: {msg: getMsg(MSG_TYPE.wrong)},
  };
};

const deleteAccount = async req => {
  const {token_firebase} = req.body;
  const userDataFirebase = await Firebase.getUserFromToken(token_firebase);

  if (userDataFirebase) {
    const deleteUserResult = await UserModel.deleteOne({
      uid: userDataFirebase.uid,
    });

    const deleteFirebaseUserRes = await Firebase.deleteAccount(
      userDataFirebase.uid,
    );

    if (deleteUserResult.deletedCount && deleteFirebaseUserRes) {
      const res = {
        msg: 'Account deleted successfully!',
      };
      return {status: STATUS_CODE.success, res};
    } else {
      return {
        status: STATUS_CODE.error,
        res: {msg: getMsg(MSG_TYPE.wrong)},
      };
    }
  } else {
    return {
      status: STATUS_CODE.error,
      res: {msg: 'Account information is incorrect!'},
    };
  }
};

const checkAccount = async req => {
  const {provider_id, email} = req.body;

  const findUserByEmailRes = await findUserByEmail(email);
  if (findUserByEmailRes) {
    const userData = findUserByEmailRes.toObject();
    const provider_data = userData.provider_data;

    let check = false;
    provider_data.forEach(provider => {
      if (provider.providerId === provider_id) {
        check = true;
      }
    });

    if (check) {
      const res = {
        msg: 'Successfully!',
      };
      return {status: STATUS_CODE.success, res};
    } else {
      const res = {
        msg: 'Failure!',
      };
      return {status: STATUS_CODE.error, res};
    }
  } else {
    const res = {
      msg: 'Successfully!',
    };
    return {status: STATUS_CODE.success, res};
  }
};

const customToken = async req => {
  const {expiresIn} = req.body;

  const newToken = JWToken.createCustomToken(expiresIn);

  const res = {
    results: {
      custom_token: newToken,
    },
    msg: 'Create custom token Successfully!',
  };
  return {status: 200, res};
};

module.exports = {
  findUserByEmail,
  findUser,
  signUpWithEmail,
  profile,
  updateImage,
  updateInformations,
  signInWithFirebase,
  sendVerificationCode,
  verifyCodeService,
  refreshToken,
  accountLink,
  checkAccount,
  accountUnLink,
  deleteAccount,
  customToken,
};
